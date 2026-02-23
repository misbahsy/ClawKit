import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import createWorkspaceScopedSandbox from "../../registry/sandbox/workspace-scoped/index.js";

describe("sandbox-workspace-scoped", () => {
  let tmpDir: string;
  let sandbox: ReturnType<typeof createWorkspaceScopedSandbox>;

  beforeEach(() => {
    tmpDir = resolve(tmpdir(), `clawkit-test-sandbox-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(resolve(tmpDir, "test.txt"), "hello world", "utf-8");
    sandbox = createWorkspaceScopedSandbox({
      workspaceDir: tmpDir,
      allowedCommands: ["echo", "cat", "ls", "node"],
    });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should execute allowed commands", async () => {
    const events = [];
    for await (const event of sandbox.execute({
      command: "echo",
      args: ["hello"],
    })) {
      events.push(event);
    }

    const stdout = events.filter((e) => e.type === "stdout").map((e) => e.data).join("");
    const exit = events.find((e) => e.type === "exit");
    expect(stdout.trim()).toBe("hello");
    expect(exit?.code).toBe(0);
  });

  it("should reject disallowed commands", async () => {
    const events = [];
    for await (const event of sandbox.execute({
      command: "rm",
      args: ["-rf", "/"],
    })) {
      events.push(event);
    }

    const stderr = events.filter((e) => e.type === "stderr").map((e) => e.data).join("");
    const exit = events.find((e) => e.type === "exit");
    expect(stderr).toContain("Command not allowed");
    expect(exit?.code).toBe(1);
  });

  it("should reject paths that escape workspace", async () => {
    const events = [];
    for await (const event of sandbox.execute({
      command: "cat",
      args: ["../../etc/passwd"],
    })) {
      events.push(event);
    }

    const stderr = events.filter((e) => e.type === "stderr").map((e) => e.data).join("");
    const exit = events.find((e) => e.type === "exit");
    expect(stderr).toContain("Path escapes workspace");
    expect(exit?.code).toBe(1);
  });

  it("should allow paths within workspace", async () => {
    const events = [];
    for await (const event of sandbox.execute({
      command: "cat",
      args: ["test.txt"],
    })) {
      events.push(event);
    }

    const stdout = events.filter((e) => e.type === "stdout").map((e) => e.data).join("");
    const exit = events.find((e) => e.type === "exit");
    expect(stdout.trim()).toBe("hello world");
    expect(exit?.code).toBe(0);
  });

  it("should use workspace as cwd", async () => {
    const events = [];
    for await (const event of sandbox.execute({
      command: "ls",
      args: [],
    })) {
      events.push(event);
    }

    const stdout = events.filter((e) => e.type === "stdout").map((e) => e.data).join("");
    expect(stdout).toContain("test.txt");
  });

  it("should cleanup without errors", async () => {
    await expect(sandbox.cleanup()).resolves.toBeUndefined();
  });
});
