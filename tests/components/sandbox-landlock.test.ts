import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChild = {
  stdout: { on: vi.fn() },
  stderr: { on: vi.fn() },
  on: vi.fn(),
  kill: vi.fn(),
};

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => mockChild),
}));

vi.mock("node:fs", () => ({
  writeFileSync: vi.fn(),
  chmodSync: vi.fn(),
  mkdtempSync: vi.fn(() => "/tmp/clawkit-landlock-test"),
  rmSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  tmpdir: () => "/tmp",
}));

vi.mock("node:path", () => ({
  resolve: (...parts: string[]) => parts.join("/"),
}));

import { spawn } from "node:child_process";
import { writeFileSync, chmodSync } from "node:fs";
import createLandlockSandbox from "../../registry/sandbox/landlock/index.js";

describe("sandbox-landlock", () => {
  let sandbox: ReturnType<typeof createLandlockSandbox>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockChild.stdout.on.mockImplementation((event: string, handler: Function) => {
      if (event === "data") {
        setTimeout(() => handler(Buffer.from("landlock output")), 10);
      }
    });
    mockChild.stderr.on.mockImplementation(() => {});
    mockChild.on.mockImplementation((event: string, handler: Function) => {
      if (event === "close") {
        setTimeout(() => handler(0), 30);
      }
    });

    sandbox = createLandlockSandbox({
      allowedPaths: ["/usr", "/lib", "/tmp"],
      denyNetwork: true,
      timeout: 30000,
    });
  });

  it("should have correct sandbox name", () => {
    expect(sandbox.name).toBe("sandbox-landlock");
  });

  it("should create a wrapper script", async () => {
    for await (const _ of sandbox.execute({
      command: "echo",
      args: ["hello"],
    })) {
      /* consume */
    }

    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("wrapper.sh"),
      expect.stringContaining("echo"),
      // No options object for this call's signature
    );
  });

  it("should make wrapper script executable", async () => {
    for await (const _ of sandbox.execute({
      command: "echo",
      args: ["hello"],
    })) {
      /* consume */
    }

    expect(chmodSync).toHaveBeenCalledWith(
      expect.stringContaining("wrapper.sh"),
      0o755,
    );
  });

  it("should spawn /bin/sh with wrapper script", async () => {
    for await (const _ of sandbox.execute({
      command: "echo",
      args: ["hello"],
    })) {
      /* consume */
    }

    expect(spawn).toHaveBeenCalledWith(
      "/bin/sh",
      [expect.stringContaining("wrapper.sh")],
      expect.any(Object),
    );
  });

  it("should set LANDLOCK_DENY_NETWORK env when denyNetwork is true", async () => {
    for await (const _ of sandbox.execute({
      command: "echo",
      args: ["test"],
    })) {
      /* consume */
    }

    const spawnCall = (spawn as any).mock.calls[0];
    const opts = spawnCall[2];
    expect(opts.env.LANDLOCK_DENY_NETWORK).toBe("1");
  });

  it("should not set LANDLOCK_DENY_NETWORK when denyNetwork is false", async () => {
    sandbox = createLandlockSandbox({
      allowedPaths: ["/usr"],
      denyNetwork: false,
    });

    for await (const _ of sandbox.execute({
      command: "echo",
      args: ["test"],
    })) {
      /* consume */
    }

    const spawnCall = (spawn as any).mock.calls[0];
    const opts = spawnCall[2];
    expect(opts.env.LANDLOCK_DENY_NETWORK).toBeUndefined();
  });

  it("should include allowed paths in wrapper script", async () => {
    for await (const _ of sandbox.execute({
      command: "ls",
      args: ["/usr"],
    })) {
      /* consume */
    }

    const writeCall = (writeFileSync as any).mock.calls.find(
      (c: any[]) => typeof c[1] === "string" && c[1].includes("landlock"),
    );
    expect(writeCall).toBeDefined();
    const scriptContent = writeCall[1] as string;
    expect(scriptContent).toContain("/usr");
    expect(scriptContent).toContain("/lib");
    expect(scriptContent).toContain("/tmp");
  });

  it("should include mount hostPaths in allowed paths", async () => {
    for await (const _ of sandbox.execute({
      command: "cat",
      args: ["/data/file.txt"],
      mounts: [{ hostPath: "/host/data", containerPath: "/data", readonly: true }],
    })) {
      /* consume */
    }

    const writeCall = (writeFileSync as any).mock.calls.find(
      (c: any[]) => typeof c[1] === "string" && c[1].includes("landlock"),
    );
    const scriptContent = writeCall[1] as string;
    expect(scriptContent).toContain("/host/data");
  });

  it("should include cwd in allowed paths", async () => {
    for await (const _ of sandbox.execute({
      command: "ls",
      args: [],
      cwd: "/workspace/project",
    })) {
      /* consume */
    }

    const writeCall = (writeFileSync as any).mock.calls.find(
      (c: any[]) => typeof c[1] === "string" && c[1].includes("landlock"),
    );
    const scriptContent = writeCall[1] as string;
    expect(scriptContent).toContain("/workspace/project");
  });

  it("should yield stdout events", async () => {
    const events = [];
    for await (const event of sandbox.execute({
      command: "echo",
      args: ["hello"],
    })) {
      events.push(event);
    }

    const stdout = events.filter((e) => e.type === "stdout");
    expect(stdout.length).toBeGreaterThan(0);
    expect(stdout[0].data).toBe("landlock output");
  });

  it("should yield exit event", async () => {
    const events = [];
    for await (const event of sandbox.execute({
      command: "echo",
      args: ["test"],
    })) {
      events.push(event);
    }

    const exit = events.find((e) => e.type === "exit");
    expect(exit).toBeDefined();
    expect(exit!.code).toBe(0);
  });

  it("should handle non-zero exit codes", async () => {
    mockChild.on.mockImplementation((event: string, handler: Function) => {
      if (event === "close") {
        setTimeout(() => handler(126), 30);
      }
    });

    const events = [];
    for await (const event of sandbox.execute({
      command: "restricted-cmd",
      args: [],
    })) {
      events.push(event);
    }

    const exit = events.find((e) => e.type === "exit");
    expect(exit?.code).toBe(126);
  });

  it("should pass env variables through to wrapper", async () => {
    for await (const _ of sandbox.execute({
      command: "env",
      args: [],
      env: { MY_VAR: "hello" },
    })) {
      /* consume */
    }

    const writeCall = (writeFileSync as any).mock.calls.find(
      (c: any[]) => typeof c[1] === "string" && c[1].includes("MY_VAR"),
    );
    expect(writeCall).toBeDefined();
    const scriptContent = writeCall[1] as string;
    expect(scriptContent).toContain('export MY_VAR="hello"');
  });

  it("should cleanup active processes and temp dirs", async () => {
    for await (const _ of sandbox.execute({
      command: "echo",
      args: ["test"],
    })) {
      /* consume */
    }

    await sandbox.cleanup();
    // Should not throw
  });
});
