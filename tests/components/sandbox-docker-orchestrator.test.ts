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

vi.mock("node:crypto", () => ({
  randomUUID: () => "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
}));

import createDockerOrchestratorSandbox from "../../registry/sandbox/docker-orchestrator/index.js";

describe("sandbox-docker-orchestrator", () => {
  let sandbox: ReturnType<typeof createDockerOrchestratorSandbox>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockContainer.attach.mockResolvedValue({
      on: vi.fn((event: string, handler: Function) => {
        if (event === "data") {
          const content = Buffer.from("orchestrator output");
          const header = Buffer.alloc(8);
          header[0] = 1; // stdout
          header.writeUInt32BE(content.length, 4);
          const frame = Buffer.concat([header, content]);
          setTimeout(() => handler(frame), 10);
        }
      }),
    });

    mockContainer.wait.mockResolvedValue({ StatusCode: 0 });

    sandbox = createDockerOrchestratorSandbox({
      image: "node:20-slim",
      networkMode: "none",
      readOnlyRoot: true,
    });
  });

  it("should have correct sandbox name", () => {
    expect(sandbox.name).toBe("sandbox-docker-orchestrator");
  });

  it("should create container with job token in env", async () => {
    const events = [];
    for await (const event of sandbox.execute({
      command: "node",
      args: ["-e", "console.log('hi')"],
    })) {
      events.push(event);
    }

    expect(mockDocker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Env: expect.arrayContaining([
          expect.stringContaining("CLAWKIT_JOB_TOKEN="),
        ]),
      }),
    );
  });

  it("should set read-only root filesystem", async () => {
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
          ReadonlyRootfs: true,
          Tmpfs: { "/tmp": "rw,noexec,nosuid,size=64m" },
        }),
      }),
    );
  });

  it("should set orchestrator labels", async () => {
    const events = [];
    for await (const event of sandbox.execute({
      command: "echo",
      args: ["test"],
    })) {
      events.push(event);
    }

    expect(mockDocker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Labels: expect.objectContaining({
          "clawkit.orchestrator": "true",
          "clawkit.job-token": expect.any(String),
        }),
      }),
    );
  });

  it("should configure network mode from config", async () => {
    for await (const _ of sandbox.execute({
      command: "echo",
      args: ["test"],
    })) {
      /* consume */
    }

    expect(mockDocker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        HostConfig: expect.objectContaining({
          NetworkMode: "none",
        }),
      }),
    );
  });

  it("should pass mount binds", async () => {
    for await (const _ of sandbox.execute({
      command: "ls",
      args: [],
      mounts: [{ hostPath: "/tmp/data", containerPath: "/data", readonly: true }],
    })) {
      /* consume */
    }

    expect(mockDocker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        HostConfig: expect.objectContaining({
          Binds: ["/tmp/data:/data:ro"],
        }),
      }),
    );
  });

  it("should check and pull image if missing", async () => {
    mockDocker.getImage.mockReturnValue({
      inspect: vi.fn().mockRejectedValue(new Error("not found")),
    });

    for await (const _ of sandbox.execute({
      command: "echo",
      args: ["test"],
    })) {
      /* consume */
    }

    expect(mockDocker.pull).toHaveBeenCalledWith("node:20-slim");
  });

  it("should start container after creation", async () => {
    for await (const _ of sandbox.execute({
      command: "echo",
      args: ["test"],
    })) {
      /* consume */
    }

    expect(mockContainer.start).toHaveBeenCalled();
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

  it("should cleanup all containers", async () => {
    for await (const _ of sandbox.execute({
      command: "echo",
      args: ["test"],
    })) {
      /* consume */
    }

    await sandbox.cleanup();
    // Cleanup should not throw even if containers were already removed
  });

  it("should pass environment variables alongside job token", async () => {
    for await (const _ of sandbox.execute({
      command: "echo",
      args: ["test"],
      env: { MY_VAR: "my_value" },
    })) {
      /* consume */
    }

    expect(mockDocker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Env: expect.arrayContaining([
          expect.stringContaining("CLAWKIT_JOB_TOKEN="),
          "MY_VAR=my_value",
        ]),
      }),
    );
  });

  it("should apply memory limit from config", async () => {
    sandbox = createDockerOrchestratorSandbox({
      memoryLimit: 256 * 1024 * 1024,
    });

    for await (const _ of sandbox.execute({
      command: "echo",
      args: ["test"],
    })) {
      /* consume */
    }

    expect(mockDocker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        HostConfig: expect.objectContaining({
          Memory: 256 * 1024 * 1024,
        }),
      }),
    );
  });
});
