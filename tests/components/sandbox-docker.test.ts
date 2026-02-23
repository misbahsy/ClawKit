import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dockerode
const mockContainer = {
  attach: vi.fn().mockResolvedValue({
    on: vi.fn(),
  }),
  start: vi.fn().mockResolvedValue(undefined),
  wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
  stop: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  kill: vi.fn().mockResolvedValue(undefined),
};

const mockDocker = {
  createContainer: vi.fn().mockResolvedValue(mockContainer),
  getImage: vi.fn().mockReturnValue({
    inspect: vi.fn().mockResolvedValue({}),
  }),
  pull: vi.fn().mockResolvedValue({}),
  modem: {
    followProgress: vi.fn((_stream: any, onFinished: Function) => onFinished(null)),
  },
};

vi.mock("dockerode", () => ({
  default: vi.fn(() => mockDocker),
}));

import createDockerSandbox from "../../registry/sandbox/docker/index.js";

describe("sandbox-docker", () => {
  let sandbox: ReturnType<typeof createDockerSandbox>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up stream to emit data then trigger wait resolution
    mockContainer.attach.mockResolvedValue({
      on: vi.fn((event: string, handler: Function) => {
        if (event === "data") {
          // Simulate docker multiplexed stream: 1 byte type, 3 padding, 4 byte size, then data
          const content = Buffer.from("hello world");
          const header = Buffer.alloc(8);
          header[0] = 1; // stdout
          header.writeUInt32BE(content.length, 4);
          const frame = Buffer.concat([header, content]);
          setTimeout(() => handler(frame), 10);
        }
      }),
    });

    mockContainer.wait.mockResolvedValue({ StatusCode: 0 });

    sandbox = createDockerSandbox({ image: "node:20-slim" });
  });

  it("should have correct sandbox name", () => {
    expect(sandbox.name).toBe("sandbox-docker");
  });

  it("should create container with correct options", async () => {
    const events = [];
    for await (const event of sandbox.execute({
      command: "node",
      args: ["-e", "console.log('hi')"],
    })) {
      events.push(event);
    }

    expect(mockDocker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Image: "node:20-slim",
        Cmd: ["node", "-e", "console.log('hi')"],
      })
    );
  });

  it("should check and pull image if missing", async () => {
    mockDocker.getImage.mockReturnValue({
      inspect: vi.fn().mockRejectedValue(new Error("not found")),
    });

    const events = [];
    for await (const event of sandbox.execute({
      command: "echo",
      args: ["test"],
    })) {
      events.push(event);
    }

    expect(mockDocker.pull).toHaveBeenCalledWith("node:20-slim");
  });

  it("should pass mount binds", async () => {
    const events = [];
    for await (const event of sandbox.execute({
      command: "ls",
      args: [],
      mounts: [{ hostPath: "/tmp/src", containerPath: "/workspace", readonly: true }],
    })) {
      events.push(event);
    }

    expect(mockDocker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        HostConfig: expect.objectContaining({
          Binds: ["/tmp/src:/workspace:ro"],
        }),
      })
    );
  });

  it("should pass resource limits", async () => {
    sandbox = createDockerSandbox({
      image: "node:20-slim",
      memoryLimit: 256 * 1024 * 1024,
      cpuQuota: 50000,
      networkAccess: false,
    });

    const events = [];
    for await (const event of sandbox.execute({
      command: "echo",
      args: ["test"],
    })) {
      events.push(event);
    }

    expect(mockDocker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        HostConfig: expect.objectContaining({
          Memory: 256 * 1024 * 1024,
          CpuQuota: 50000,
          NetworkMode: "none",
        }),
      })
    );
  });

  it("should cleanup all containers", async () => {
    // Run one command to create a container
    for await (const _ of sandbox.execute({
      command: "echo",
      args: ["test"],
    })) { /* consume */ }

    await sandbox.cleanup();
    // Cleanup should stop and remove containers
    // (container was already removed after execution, so this verifies no errors)
  });

  it("should start container after creation", async () => {
    for await (const _ of sandbox.execute({
      command: "echo",
      args: ["test"],
    })) { /* consume */ }

    expect(mockContainer.start).toHaveBeenCalled();
  });
});
