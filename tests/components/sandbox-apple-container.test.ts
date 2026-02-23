import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process
const mockSpawnProcess = {
  stdout: { on: vi.fn() },
  stderr: { on: vi.fn() },
  on: vi.fn(),
  kill: vi.fn(),
};

const mockExecFile = vi.fn();
const mockSpawn = vi.fn(() => mockSpawnProcess);

vi.mock("node:child_process", () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
  execFile: (...args: any[]) => mockExecFile(...args),
}));

vi.mock("node:crypto", () => ({
  randomUUID: () => "12345678-abcd-efgh-ijkl-123456789abc",
}));

import createAppleContainerSandbox from "../../registry/sandbox/apple-container/index.js";

describe("sandbox-apple-container", () => {
  let sandbox: ReturnType<typeof createAppleContainerSandbox>;

  beforeEach(() => {
    vi.clearAllMocks();

    // execFile mock: succeeds for create, start, stop, rm
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
      cb(null, "", "");
    });

    // spawn mock: simulates stdout + exit
    mockSpawnProcess.stdout.on.mockImplementation((event: string, handler: Function) => {
      if (event === "data") {
        setTimeout(() => handler(Buffer.from("container output")), 10);
      }
    });
    mockSpawnProcess.stderr.on.mockImplementation(() => {});
    mockSpawnProcess.on.mockImplementation((event: string, handler: Function) => {
      if (event === "close") {
        setTimeout(() => handler(0), 30);
      }
    });

    sandbox = createAppleContainerSandbox({ image: "default", timeout: 30000 });
  });

  it("should have correct sandbox name", () => {
    expect(sandbox.name).toBe("sandbox-apple-container");
  });

  it("should create container with correct args", async () => {
    const events = [];
    for await (const event of sandbox.execute({
      command: "echo",
      args: ["hello"],
    })) {
      events.push(event);
    }

    expect(mockExecFile).toHaveBeenCalledWith(
      "container",
      expect.arrayContaining(["create", "--name", expect.stringContaining("clawkit-")]),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("should start container after creation", async () => {
    const events = [];
    for await (const event of sandbox.execute({
      command: "echo",
      args: ["test"],
    })) {
      events.push(event);
    }

    // Second execFile call should be start
    const calls = mockExecFile.mock.calls;
    const startCall = calls.find((c: any[]) => c[1]?.[0] === "start");
    expect(startCall).toBeDefined();
  });

  it("should pass mount options", async () => {
    const events = [];
    for await (const event of sandbox.execute({
      command: "ls",
      args: [],
      mounts: [{ hostPath: "/tmp/src", containerPath: "/workspace", readonly: true }],
    })) {
      events.push(event);
    }

    const createCall = mockExecFile.mock.calls.find((c: any[]) => c[1]?.[0] === "create");
    expect(createCall).toBeDefined();
    const args = createCall![1] as string[];
    expect(args).toContain("--mount");
    expect(args).toContain("/tmp/src:/workspace:ro");
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
    expect(stdout[0].data).toBe("container output");
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

  it("should handle container creation failure", async () => {
    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: Function) => {
      if (args[0] === "create") {
        cb(new Error("creation failed"), "", "creation failed");
      } else {
        cb(null, "", "");
      }
    });

    const events = [];
    for await (const event of sandbox.execute({
      command: "echo",
      args: ["test"],
    })) {
      events.push(event);
    }

    const stderr = events.filter((e) => e.type === "stderr");
    expect(stderr.length).toBeGreaterThan(0);
    expect(stderr[0].data).toContain("Failed to create container");
    expect(events.find((e) => e.type === "exit")?.code).toBe(1);
  });

  it("should cleanup active containers", async () => {
    // Run a command to register a container
    for await (const _ of sandbox.execute({
      command: "echo",
      args: ["test"],
    })) {
      /* consume */
    }

    await sandbox.cleanup();

    // Cleanup should call stop and rm on containers
    // Since the container was already cleaned up post-execution,
    // this verifies no errors occur
  });

  it("should pass memory limit from config", async () => {
    sandbox = createAppleContainerSandbox({
      image: "custom-image",
      memoryLimit: 256 * 1024 * 1024,
    });

    for await (const _ of sandbox.execute({
      command: "echo",
      args: ["test"],
    })) {
      /* consume */
    }

    const createCall = mockExecFile.mock.calls.find((c: any[]) => c[1]?.[0] === "create");
    expect(createCall).toBeDefined();
    const args = createCall![1] as string[];
    expect(args).toContain("--memory");
    expect(args).toContain(String(256 * 1024 * 1024));
  });
});
