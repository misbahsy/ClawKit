import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChild = {
  stdout: { on: vi.fn() },
  stderr: { on: vi.fn() },
  on: vi.fn(),
  kill: vi.fn(),
};

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => mockChild),
  ChildProcess: vi.fn(),
}));

vi.mock("node:fs", () => ({
  mkdtempSync: vi.fn(() => "/tmp/clawkit-fc-test"),
  rmSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  tmpdir: () => "/tmp",
}));

vi.mock("node:path", () => ({
  resolve: (...parts: string[]) => parts.join("/"),
}));

// Mock fetch for Firecracker API calls
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { spawn } from "node:child_process";
import createFirecrackerSandbox from "../../registry/sandbox/firecracker/index.js";

describe("sandbox-firecracker", () => {
  let sandbox: ReturnType<typeof createFirecrackerSandbox>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock Firecracker API responses
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => "{}",
    });

    mockChild.stdout.on.mockImplementation((event: string, handler: Function) => {
      if (event === "data") {
        setTimeout(() => handler(Buffer.from("vm output")), 10);
      }
    });
    mockChild.stderr.on.mockImplementation(() => {});
    mockChild.on.mockImplementation((event: string, handler: Function) => {
      if (event === "close") {
        setTimeout(() => handler(0), 50);
      }
    });

    sandbox = createFirecrackerSandbox({
      firecrackerPath: "/usr/bin/firecracker",
      kernelPath: "./vmlinux",
      rootfsPath: "./rootfs.ext4",
      memoryMb: 256,
      vcpuCount: 2,
      timeout: 30000,
    });
  });

  it("should have correct sandbox name", () => {
    expect(sandbox.name).toBe("sandbox-firecracker");
  });

  it("should spawn firecracker with api-sock argument", async () => {
    const events = [];
    for await (const event of sandbox.execute({
      command: "echo",
      args: ["hello"],
    })) {
      events.push(event);
    }

    expect(spawn).toHaveBeenCalledWith(
      "/usr/bin/firecracker",
      expect.arrayContaining(["--api-sock"]),
      expect.any(Object),
    );
  });

  it("should configure machine with vcpu and memory via API", async () => {
    const events = [];
    for await (const event of sandbox.execute({
      command: "echo",
      args: ["test"],
    })) {
      events.push(event);
    }

    // Check that the machine-config API was called
    const machineConfigCall = mockFetch.mock.calls.find(
      (call: any[]) => call[0].includes("/machine-config"),
    );
    expect(machineConfigCall).toBeDefined();
    const body = JSON.parse(machineConfigCall![1].body);
    expect(body.vcpu_count).toBe(2);
    expect(body.mem_size_mib).toBe(256);
  });

  it("should configure boot source via API", async () => {
    for await (const _ of sandbox.execute({
      command: "echo",
      args: ["test"],
    })) {
      /* consume */
    }

    const bootCall = mockFetch.mock.calls.find(
      (call: any[]) => call[0].includes("/boot-source"),
    );
    expect(bootCall).toBeDefined();
    const body = JSON.parse(bootCall![1].body);
    expect(body.kernel_image_path).toBe("./vmlinux");
  });

  it("should configure root drive via API", async () => {
    for await (const _ of sandbox.execute({
      command: "echo",
      args: ["test"],
    })) {
      /* consume */
    }

    const driveCall = mockFetch.mock.calls.find(
      (call: any[]) => call[0].includes("/drives/rootfs"),
    );
    expect(driveCall).toBeDefined();
    const body = JSON.parse(driveCall![1].body);
    expect(body.path_on_host).toBe("./rootfs.ext4");
    expect(body.is_root_device).toBe(true);
  });

  it("should send InstanceStart action via API", async () => {
    for await (const _ of sandbox.execute({
      command: "echo",
      args: ["test"],
    })) {
      /* consume */
    }

    const actionCall = mockFetch.mock.calls.find(
      (call: any[]) => call[0].includes("/actions"),
    );
    expect(actionCall).toBeDefined();
    const body = JSON.parse(actionCall![1].body);
    expect(body.action_type).toBe("InstanceStart");
  });

  it("should yield stdout events from VM", async () => {
    const events = [];
    for await (const event of sandbox.execute({
      command: "echo",
      args: ["hello"],
    })) {
      events.push(event);
    }

    const stdout = events.filter((e) => e.type === "stdout");
    expect(stdout.length).toBeGreaterThan(0);
    expect(stdout[0].data).toBe("vm output");
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

  it("should handle API failure gracefully", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal error",
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
    expect(stderr[0].data).toContain("Failed to configure Firecracker VM");
    expect(events.find((e) => e.type === "exit")?.code).toBe(1);
  });

  it("should cleanup active VMs", async () => {
    for await (const _ of sandbox.execute({
      command: "echo",
      args: ["test"],
    })) {
      /* consume */
    }

    await sandbox.cleanup();
    // Should not throw even if VMs were already cleaned up
  });

  it("should write command script to temp directory", async () => {
    const { writeFileSync } = await import("node:fs");

    for await (const _ of sandbox.execute({
      command: "echo",
      args: ["hello", "world"],
    })) {
      /* consume */
    }

    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("cmd.sh"),
      "echo hello world",
      expect.any(Object),
    );
  });
});
