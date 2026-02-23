import { describe, it, expect, beforeEach } from "vitest";
import createWasmSandbox from "../../registry/sandbox/wasm/index.js";

describe("sandbox-wasm", () => {
  let sandbox: ReturnType<typeof createWasmSandbox>;

  beforeEach(() => {
    sandbox = createWasmSandbox({
      capabilities: ["fs.read", "fs.write", "exec"],
      rateLimit: { maxCalls: 100, windowMs: 60000 },
    });
  });

  it("should have correct sandbox name", () => {
    expect(sandbox.name).toBe("sandbox-wasm");
  });

  it("should execute allowed commands and yield stdout", async () => {
    const events = [];
    for await (const event of sandbox.execute({
      command: "echo",
      args: ["hello world"],
    })) {
      events.push(event);
    }

    const stdout = events.filter((e) => e.type === "stdout").map((e) => e.data).join("");
    const exit = events.find((e) => e.type === "exit");
    expect(stdout.trim()).toBe("hello world");
    expect(exit?.code).toBe(0);
  });

  it("should deny commands requiring missing capabilities", async () => {
    const restrictedSandbox = createWasmSandbox({
      capabilities: ["fs.read"],
    });

    const events = [];
    for await (const event of restrictedSandbox.execute({
      command: "curl",
      args: ["http://example.com"],
    })) {
      events.push(event);
    }

    const stderr = events.filter((e) => e.type === "stderr").map((e) => e.data).join("");
    const exit = events.find((e) => e.type === "exit");
    expect(stderr).toContain("Permission denied");
    expect(exit?.code).toBe(126);
  });

  it("should deny write commands when only fs.read is granted", async () => {
    const readOnlySandbox = createWasmSandbox({
      capabilities: ["fs.read"],
    });

    const events = [];
    for await (const event of readOnlySandbox.execute({
      command: "echo",
      args: ["data"],
    })) {
      events.push(event);
    }

    const stderr = events.filter((e) => e.type === "stderr").map((e) => e.data).join("");
    const exit = events.find((e) => e.type === "exit");
    expect(stderr).toContain("Permission denied");
    expect(exit?.code).toBe(126);
  });

  it("should enforce rate limits", async () => {
    const limitedSandbox = createWasmSandbox({
      capabilities: ["exec"],
      rateLimit: { maxCalls: 2, windowMs: 60000 },
    });

    // First two calls should succeed
    for (let i = 0; i < 2; i++) {
      const events = [];
      for await (const event of limitedSandbox.execute({
        command: "true",
        args: [],
      })) {
        events.push(event);
      }
      const exit = events.find((e) => e.type === "exit");
      expect(exit?.code).toBe(0);
    }

    // Third call should be rate-limited
    const events = [];
    for await (const event of limitedSandbox.execute({
      command: "true",
      args: [],
    })) {
      events.push(event);
    }

    const stderr = events.filter((e) => e.type === "stderr").map((e) => e.data).join("");
    const exit = events.find((e) => e.type === "exit");
    expect(stderr).toContain("Rate limit exceeded");
    expect(exit?.code).toBe(429);
  });

  it("should cleanup call trackers", async () => {
    // Make some calls to populate trackers
    for await (const _ of sandbox.execute({
      command: "echo",
      args: ["test"],
    })) { /* consume */ }

    await sandbox.cleanup();

    // After cleanup, rate limits should be reset - verify by using a very low limit
    const limitedSandbox = createWasmSandbox({
      capabilities: ["exec"],
      rateLimit: { maxCalls: 1, windowMs: 60000 },
    });

    // First call works
    const events1 = [];
    for await (const event of limitedSandbox.execute({
      command: "true",
      args: [],
    })) {
      events1.push(event);
    }
    expect(events1.find((e) => e.type === "exit")?.code).toBe(0);

    // Cleanup resets
    await limitedSandbox.cleanup();

    // After cleanup, should work again
    const events2 = [];
    for await (const event of limitedSandbox.execute({
      command: "true",
      args: [],
    })) {
      events2.push(event);
    }
    expect(events2.find((e) => e.type === "exit")?.code).toBe(0);
  });

  it("should handle command execution with non-zero exit code", async () => {
    const events = [];
    for await (const event of sandbox.execute({
      command: "/bin/sh",
      args: ["-c", "exit 42"],
    })) {
      events.push(event);
    }

    const exit = events.find((e) => e.type === "exit");
    expect(exit).toBeDefined();
    expect(exit?.code).toBe(42);
  });

  it("should track rate limits per command", async () => {
    const limitedSandbox = createWasmSandbox({
      capabilities: ["exec"],
      rateLimit: { maxCalls: 1, windowMs: 60000 },
    });

    // First command succeeds
    const events1 = [];
    for await (const event of limitedSandbox.execute({
      command: "true",
      args: [],
    })) {
      events1.push(event);
    }
    expect(events1.find((e) => e.type === "exit")?.code).toBe(0);

    // Same command rate-limited
    const events2 = [];
    for await (const event of limitedSandbox.execute({
      command: "true",
      args: [],
    })) {
      events2.push(event);
    }
    expect(events2.find((e) => e.type === "exit")?.code).toBe(429);

    // Different command still works (tracked separately)
    const events3 = [];
    for await (const event of limitedSandbox.execute({
      command: "false",
      args: [],
    })) {
      events3.push(event);
    }
    // "false" command exits with 1, not 429
    expect(events3.find((e) => e.type === "exit")?.code).toBe(1);
  });

  it("should allow network commands when network capability is granted", async () => {
    const networkSandbox = createWasmSandbox({
      capabilities: ["network", "exec"],
    });

    // This won't actually succeed (no server) but capability check should pass
    // The command itself will fail, but not with permission denied
    const events = [];
    for await (const event of networkSandbox.execute({
      command: "curl",
      args: ["--max-time", "1", "http://localhost:99999"],
    })) {
      events.push(event);
    }

    const stderr = events.filter((e) => e.type === "stderr").map((e) => e.data).join("");
    // Should NOT be permission denied - it should be a curl connection error
    expect(stderr).not.toContain("Permission denied");
  });
});
