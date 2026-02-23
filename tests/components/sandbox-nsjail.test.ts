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

import { spawn } from "node:child_process";
import createNsjailSandbox from "../../registry/sandbox/nsjail/index.js";

describe("sandbox-nsjail", () => {
  let sandbox: ReturnType<typeof createNsjailSandbox>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockChild.stdout.on.mockImplementation((event: string, handler: Function) => {
      if (event === "data") {
        setTimeout(() => handler(Buffer.from("jailed output")), 10);
      }
    });
    mockChild.stderr.on.mockImplementation(() => {});
    mockChild.on.mockImplementation((event: string, handler: Function) => {
      if (event === "close") {
        setTimeout(() => handler(0), 30);
      }
    });

    sandbox = createNsjailSandbox({
      nsjailPath: "/usr/bin/nsjail",
      memoryLimit: 256 * 1024 * 1024,
      timeLimit: 10,
      networkAccess: false,
    });
  });

  it("should have correct sandbox name", () => {
    expect(sandbox.name).toBe("sandbox-nsjail");
  });

  it("should spawn nsjail with correct binary path", async () => {
    const events = [];
    for await (const event of sandbox.execute({
      command: "echo",
      args: ["hello"],
    })) {
      events.push(event);
    }

    expect(spawn).toHaveBeenCalledWith(
      "/usr/bin/nsjail",
      expect.any(Array),
      expect.any(Object),
    );
  });

  it("should pass time limit argument", async () => {
    for await (const _ of sandbox.execute({
      command: "echo",
      args: ["test"],
    })) {
      /* consume */
    }

    const args = (spawn as any).mock.calls[0][1] as string[];
    const timeLimitIdx = args.indexOf("--time_limit");
    expect(timeLimitIdx).toBeGreaterThan(-1);
    expect(args[timeLimitIdx + 1]).toBe("10");
  });

  it("should pass memory limit as rlimit_as in MB", async () => {
    for await (const _ of sandbox.execute({
      command: "echo",
      args: ["test"],
    })) {
      /* consume */
    }

    const args = (spawn as any).mock.calls[0][1] as string[];
    const rlimitIdx = args.indexOf("--rlimit_as");
    expect(rlimitIdx).toBeGreaterThan(-1);
    expect(args[rlimitIdx + 1]).toBe("256"); // 256 * 1024 * 1024 / (1024 * 1024) = 256
  });

  it("should pass mount options for read-only and read-write", async () => {
    for await (const _ of sandbox.execute({
      command: "cat",
      args: ["/data/file.txt"],
      mounts: [
        { hostPath: "/host/data", containerPath: "/data", readonly: true },
        { hostPath: "/host/output", containerPath: "/output", readonly: false },
      ],
    })) {
      /* consume */
    }

    const args = (spawn as any).mock.calls[0][1] as string[];
    expect(args).toContain("-R");
    expect(args).toContain("/host/data:/data");
    expect(args).toContain("-B");
    expect(args).toContain("/host/output:/output");
  });

  it("should pass environment variables", async () => {
    for await (const _ of sandbox.execute({
      command: "env",
      args: [],
      env: { MY_VAR: "value1" },
    })) {
      /* consume */
    }

    const args = (spawn as any).mock.calls[0][1] as string[];
    expect(args).toContain("--env");
    expect(args).toContain("MY_VAR=value1");
  });

  it("should pass cwd option", async () => {
    for await (const _ of sandbox.execute({
      command: "ls",
      args: [],
      cwd: "/workspace",
    })) {
      /* consume */
    }

    const args = (spawn as any).mock.calls[0][1] as string[];
    expect(args).toContain("--cwd");
    expect(args).toContain("/workspace");
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
    expect(stdout[0].data).toBe("jailed output");
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
        setTimeout(() => handler(1), 30);
      }
    });

    const events = [];
    for await (const event of sandbox.execute({
      command: "false",
      args: [],
    })) {
      events.push(event);
    }

    const exit = events.find((e) => e.type === "exit");
    expect(exit?.code).toBe(1);
  });

  it("should place command after -- separator", async () => {
    for await (const _ of sandbox.execute({
      command: "echo",
      args: ["hello", "world"],
    })) {
      /* consume */
    }

    const args = (spawn as any).mock.calls[0][1] as string[];
    const dashDashIdx = args.indexOf("--");
    expect(dashDashIdx).toBeGreaterThan(-1);
    expect(args[dashDashIdx + 1]).toBe("echo");
    expect(args[dashDashIdx + 2]).toBe("hello");
    expect(args[dashDashIdx + 3]).toBe("world");
  });

  it("should cleanup active processes", async () => {
    for await (const _ of sandbox.execute({
      command: "echo",
      args: ["test"],
    })) {
      /* consume */
    }

    await sandbox.cleanup();
    // Processes that already exited should not cause errors
  });
});
