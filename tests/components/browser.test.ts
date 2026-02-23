import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock puppeteer
const mockPage = {
  goto: vi.fn().mockResolvedValue(undefined),
  title: vi.fn().mockResolvedValue("Test Page"),
  click: vi.fn().mockResolvedValue(undefined),
  type: vi.fn().mockResolvedValue(undefined),
  screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-png").toString("base64")),
  evaluate: vi.fn().mockResolvedValue("evaluated result"),
  setDefaultTimeout: vi.fn(),
  setViewport: vi.fn().mockResolvedValue(undefined),
  waitForNetworkIdle: vi.fn().mockResolvedValue(undefined),
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

import createBrowserTool from "../../registry/tools/browser/index.js";

describe("tool-browser", () => {
  const context = { workspaceDir: ".", sessionId: "test-session" };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPage.evaluate.mockResolvedValue("Page text content");
  });

  it("should have the correct tool interface", () => {
    const tool = createBrowserTool({});
    expect(tool.name).toBe("browser");
    expect(tool.description).toBeTruthy();
    expect(tool.parameters.required).toContain("action");
    expect(tool.parameters.properties.action.enum).toEqual([
      "navigate", "click", "type", "screenshot", "evaluate",
    ]);
  });

  it("should navigate to a URL and return content", async () => {
    const tool = createBrowserTool({});
    const result = await tool.execute(
      { action: "navigate", url: "https://example.com" },
      context,
    );

    expect(mockPage.goto).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({ waitUntil: "domcontentloaded" }),
    );
    expect(result.output).toContain("Navigated to");
    expect(result.output).toContain("Test Page");
  });

  it("should error if navigate without URL", async () => {
    const tool = createBrowserTool({});
    const result = await tool.execute({ action: "navigate" }, context);

    expect(result.error).toContain("URL is required");
  });

  it("should click an element", async () => {
    const tool = createBrowserTool({});
    const result = await tool.execute(
      { action: "click", url: "https://example.com", selector: "#btn" },
      context,
    );

    expect(mockPage.goto).toHaveBeenCalled();
    expect(mockPage.click).toHaveBeenCalledWith("#btn");
    expect(result.output).toContain("Clicked");
  });

  it("should error if click without selector", async () => {
    const tool = createBrowserTool({});
    const result = await tool.execute({ action: "click" }, context);

    expect(result.error).toContain("Selector is required");
  });

  it("should type text into an element", async () => {
    const tool = createBrowserTool({});
    const result = await tool.execute(
      { action: "type", selector: "#input", text: "hello" },
      context,
    );

    expect(mockPage.type).toHaveBeenCalledWith("#input", "hello");
    expect(result.output).toContain("Typed");
  });

  it("should error if type without selector", async () => {
    const tool = createBrowserTool({});
    const result = await tool.execute({ action: "type", text: "hello" }, context);

    expect(result.error).toContain("Selector is required");
  });

  it("should error if type without text", async () => {
    const tool = createBrowserTool({});
    const result = await tool.execute({ action: "type", selector: "#input" }, context);

    expect(result.error).toContain("Text is required");
  });

  it("should take a screenshot", async () => {
    const tool = createBrowserTool({});
    const result = await tool.execute(
      { action: "screenshot", url: "https://example.com" },
      context,
    );

    expect(mockPage.screenshot).toHaveBeenCalled();
    expect(result.output).toContain("Screenshot captured");
    expect(result.media).toHaveLength(1);
    expect(result.media![0].type).toBe("image");
    expect(result.media![0].mimeType).toBe("image/png");
  });

  it("should evaluate JavaScript in page context", async () => {
    mockPage.evaluate.mockResolvedValue({ count: 42 });

    const tool = createBrowserTool({});
    const result = await tool.execute(
      { action: "evaluate", script: "document.querySelectorAll('a').length" },
      context,
    );

    expect(mockPage.evaluate).toHaveBeenCalledWith("document.querySelectorAll('a').length");
    expect(result.output).toContain("42");
  });

  it("should error if evaluate without script", async () => {
    const tool = createBrowserTool({});
    const result = await tool.execute({ action: "evaluate" }, context);

    expect(result.error).toContain("Script is required");
  });

  it("should always close browser after execution", async () => {
    const tool = createBrowserTool({});
    await tool.execute({ action: "navigate", url: "https://example.com" }, context);

    expect(mockBrowser.close).toHaveBeenCalled();
  });

  it("should handle puppeteer errors gracefully", async () => {
    mockPage.goto.mockRejectedValueOnce(new Error("Navigation failed"));

    const tool = createBrowserTool({});
    const result = await tool.execute(
      { action: "navigate", url: "https://broken.test" },
      context,
    );

    expect(result.error).toContain("Navigation failed");
  });
});
