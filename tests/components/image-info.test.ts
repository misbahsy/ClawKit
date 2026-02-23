import { describe, it, expect, vi, beforeEach } from "vitest";

const mockMetadata = {
  format: "png",
  width: 1920,
  height: 1080,
  channels: 4,
  space: "srgb",
  density: 72,
  hasAlpha: true,
  orientation: undefined,
  size: 245760,
  exif: undefined,
};

const mockStats = {
  channels: [
    { min: 0, max: 255, mean: 128.5 },
    { min: 10, max: 240, mean: 120.3 },
    { min: 5, max: 250, mean: 115.8 },
    { min: 0, max: 255, mean: 200.0 },
  ],
};

const mockImage = {
  metadata: vi.fn().mockResolvedValue(mockMetadata),
  stats: vi.fn().mockResolvedValue(mockStats),
};

vi.mock("sharp", () => ({
  default: vi.fn(() => mockImage),
}));

import createImageInfoTool from "../../registry/tools/image-info/index.js";

describe("tool-image-info", () => {
  const context = { workspaceDir: "/workspace", sessionId: "test-session" };

  beforeEach(() => {
    vi.clearAllMocks();
    mockImage.metadata.mockResolvedValue(mockMetadata);
    mockImage.stats.mockResolvedValue(mockStats);
  });

  it("should have the correct tool interface", () => {
    const tool = createImageInfoTool({});
    expect(tool.name).toBe("image_info");
    expect(tool.description).toBeTruthy();
    expect(tool.parameters.required).toContain("path");
  });

  it("should return image dimensions and format", async () => {
    const tool = createImageInfoTool({});
    const result = await tool.execute({ path: "test.png" }, context);

    expect(result.output).toContain("Format: png");
    expect(result.output).toContain("1920x1080");
    expect(result.output).toContain("Channels: 4");
    expect(result.output).toContain("srgb");
  });

  it("should report DPI when available", async () => {
    const tool = createImageInfoTool({});
    const result = await tool.execute({ path: "test.png" }, context);

    expect(result.output).toContain("DPI: 72");
  });

  it("should report alpha channel status", async () => {
    const tool = createImageInfoTool({});
    const result = await tool.execute({ path: "test.png" }, context);

    expect(result.output).toContain("Alpha Channel: yes");
  });

  it("should report file size", async () => {
    const tool = createImageInfoTool({});
    const result = await tool.execute({ path: "test.png" }, context);

    expect(result.output).toContain("240.0 KB");
  });

  it("should report EXIF data presence", async () => {
    mockImage.metadata.mockResolvedValueOnce({
      ...mockMetadata,
      exif: Buffer.from("fake-exif-data"),
    });

    const tool = createImageInfoTool({});
    const result = await tool.execute({ path: "photo.jpg" }, context);

    expect(result.output).toContain("EXIF Data: present");
  });

  it("should report no EXIF data when absent", async () => {
    const tool = createImageInfoTool({});
    const result = await tool.execute({ path: "test.png" }, context);

    expect(result.output).toContain("EXIF Data: none");
  });

  it("should include color statistics", async () => {
    const tool = createImageInfoTool({});
    const result = await tool.execute({ path: "test.png" }, context);

    expect(result.output).toContain("Color Stats");
    expect(result.output).toContain("Red");
    expect(result.output).toContain("Green");
    expect(result.output).toContain("Blue");
    expect(result.output).toContain("Alpha");
    expect(result.output).toContain("mean=128.5");
  });

  it("should return metadata object", async () => {
    const tool = createImageInfoTool({});
    const result = await tool.execute({ path: "test.png" }, context);

    expect(result.metadata).toEqual(
      expect.objectContaining({
        format: "png",
        width: 1920,
        height: 1080,
        channels: 4,
        space: "srgb",
        hasAlpha: true,
        density: 72,
      }),
    );
  });

  it("should handle errors for non-existent files", async () => {
    mockImage.metadata.mockRejectedValueOnce(new Error("Input file is missing"));

    const tool = createImageInfoTool({});
    const result = await tool.execute({ path: "nonexistent.png" }, context);

    expect(result.error).toContain("Input file is missing");
  });

  it("should handle unsupported formats", async () => {
    mockImage.metadata.mockRejectedValueOnce(
      new Error("Input buffer contains unsupported image format"),
    );

    const tool = createImageInfoTool({});
    const result = await tool.execute({ path: "file.bmp" }, context);

    expect(result.error).toContain("unsupported image format");
  });
});
