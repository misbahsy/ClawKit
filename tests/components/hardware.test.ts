import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("systeminformation", () => ({
  cpu: vi.fn().mockResolvedValue({
    manufacturer: "Apple",
    brand: "M2 Pro",
    physicalCores: 10,
    cores: 12,
    speed: 3.5,
    speedMax: 3.5,
  }),
  currentLoad: vi.fn().mockResolvedValue({
    currentLoad: 23.4,
  }),
  mem: vi.fn().mockResolvedValue({
    total: 34359738368, // 32 GB
    used: 17179869184, // 16 GB
    free: 17179869184, // 16 GB
  }),
  fsSize: vi.fn().mockResolvedValue([
    { mount: "/", size: 500107862016, used: 250053931008, use: 50.0 },
    { mount: "/Volumes/Data", size: 1000215724032, used: 600129434419, use: 60.0 },
  ]),
  networkInterfaces: vi.fn().mockResolvedValue([
    { iface: "en0", ip4: "192.168.1.100", type: "wireless", speed: 1000, internal: false },
    { iface: "lo0", ip4: "127.0.0.1", type: "loopback", speed: null, internal: true },
  ]),
}));

import createHardwareTool from "../../registry/tools/hardware/index.js";

describe("tool-hardware", () => {
  const context = { workspaceDir: ".", sessionId: "test-session" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have the correct tool interface", () => {
    const tool = createHardwareTool({});
    expect(tool.name).toBe("hardware");
    expect(tool.description).toBeTruthy();
    expect(tool.parameters.required).toContain("info");
    expect(tool.parameters.properties.info.enum).toEqual([
      "cpu", "memory", "disk", "network", "all",
    ]);
  });

  it("should return CPU information", async () => {
    const tool = createHardwareTool({});
    const result = await tool.execute({ info: "cpu" }, context);

    expect(result.output).toContain("CPU");
    expect(result.output).toContain("Apple");
    expect(result.output).toContain("M2 Pro");
    expect(result.output).toContain("10 physical");
    expect(result.output).toContain("23.4%");
  });

  it("should return memory information", async () => {
    const tool = createHardwareTool({});
    const result = await tool.execute({ info: "memory" }, context);

    expect(result.output).toContain("Memory");
    expect(result.output).toContain("32.0 GB");
    expect(result.output).toContain("50.0%");
  });

  it("should return disk information", async () => {
    const tool = createHardwareTool({});
    const result = await tool.execute({ info: "disk" }, context);

    expect(result.output).toContain("Disk");
    expect(result.output).toContain("/");
    expect(result.output).toContain("50.0%");
    expect(result.output).toContain("/Volumes/Data");
  });

  it("should return network information", async () => {
    const tool = createHardwareTool({});
    const result = await tool.execute({ info: "network" }, context);

    expect(result.output).toContain("Network");
    expect(result.output).toContain("en0");
    expect(result.output).toContain("192.168.1.100");
    // Should not include loopback
    expect(result.output).not.toContain("lo0");
  });

  it("should return all information when info is 'all'", async () => {
    const tool = createHardwareTool({});
    const result = await tool.execute({ info: "all" }, context);

    expect(result.output).toContain("CPU");
    expect(result.output).toContain("Memory");
    expect(result.output).toContain("Disk");
    expect(result.output).toContain("Network");
  });

  it("should include metadata in result", async () => {
    const tool = createHardwareTool({});
    const result = await tool.execute({ info: "cpu" }, context);

    expect(result.metadata).toEqual({ info: "cpu" });
  });

  it("should handle systeminformation errors", async () => {
    const si = await import("systeminformation");
    (si.cpu as any).mockRejectedValueOnce(new Error("Permission denied"));

    const tool = createHardwareTool({});
    const result = await tool.execute({ info: "cpu" }, context);

    expect(result.error).toContain("Permission denied");
  });
});
