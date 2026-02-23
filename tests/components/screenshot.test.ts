import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock puppeteer
const mockPage = {
  goto: vi.fn().mockResolvedValue(undefined),
  title: vi.fn().mockResolvedValue("Example Page"),
  screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-screenshot-data")),
  setDefaultTimeout: vi.fn(),
  setViewport: vi.fn().mockResolvedValue(undefined),
};

const mockBrowser = {
  newPage: vi.fn().mockResolvedValue(mockPage),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock("puppeteer", () => ({
  default: {
    launch: vi.fn().mockResolvedValue(mockBrowser),
  },
}));

import createScreenshotTool from "../../registry/tools/screenshot/index.js";

describe("tool-screenshot", () => {
  const context = { workspaceDir: ".", sessionId: "test-session" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have the correct tool interface", () => {
    const tool = createScreenshotTool({});
    expect(tool.name).toBe("screenshot");
    expect(tool.description).toBeTruthy();
    expect(tool.parameters.required).toContain("url");
    expect(tool.parameters.properties).toHaveProperty("width");
    expect(tool.parameters.properties).toHaveProperty("height");
    expect(tool.parameters.properties).toHaveProperty("fullPage");
  });

  it("should capture a screenshot with default viewport", async () => {
    const tool = createScreenshotTool({});
    const result = await tool.execute(
      { url: "https://example.com" },
      context,
    );

    expect(mockPage.setViewport).toHaveBeenCalledWith({ width: 1280, height: 720 });
    expect(mockPage.goto).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({ waitUntil: "networkidle2" }),
    );
    expect(mockPage.screenshot).toHaveBeenCalledWith(
      expect.objectContaining({ fullPage: false, type: "png" }),
    );
    expect(result.output).toContain("Screenshot of");
    expect(result.output).toContain("Example Page");
    expect(result.media).toHaveLength(1);
    expect(result.media![0].type).toBe("image");
    expect(result.media![0].mimeType).toBe("image/png");
  });

  it("should use custom viewport dimensions", async () => {
    const tool = createScreenshotTool({});
    await tool.execute(
      { url: "https://example.com", width: 800, height: 600 },
      context,
    );

    expect(mockPage.setViewport).toHaveBeenCalledWith({ width: 800, height: 600 });
  });

  it("should support full page capture", async () => {
    const tool = createScreenshotTool({});
    await tool.execute(
      { url: "https://example.com", fullPage: true },
      context,
    );

    expect(mockPage.screenshot).toHaveBeenCalledWith(
      expect.objectContaining({ fullPage: true }),
    );
  });

  it("should use config defaults for viewport", async () => {
    const tool = createScreenshotTool({ defaultWidth: 1920, defaultHeight: 1080 });
    await tool.execute({ url: "https://example.com" }, context);

    expect(mockPage.setViewport).toHaveBeenCalledWith({ width: 1920, height: 1080 });
  });

  it("should return metadata about the screenshot", async () => {
    const tool = createScreenshotTool({});
    const result = await tool.execute(
      { url: "https://example.com" },
      context,
    );

    expect(result.metadata).toEqual(
      expect.objectContaining({
        url: "https://example.com",
        title: "Example Page",
        width: 1280,
        height: 720,
        fullPage: false,
      }),
    );
  });

  it("should always close browser", async () => {
    const tool = createScreenshotTool({});
    await tool.execute({ url: "https://example.com" }, context);

    expect(mockBrowser.close).toHaveBeenCalled();
  });

  it("should handle navigation errors", async () => {
    mockPage.goto.mockRejectedValueOnce(new Error("Timeout exceeded"));

    const tool = createScreenshotTool({});
    const result = await tool.execute(
      { url: "https://slow.test" },
      context,
    );

    expect(result.error).toContain("Timeout exceeded");
  });
});
