import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import createWebFetchTool from "../../registry/tools/web-fetch/index.js";

describe("tool-web-fetch", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const context = { workspaceDir: ".", sessionId: "test-session" };

  it("should create a tool with correct interface", () => {
    const tool = createWebFetchTool({});
    expect(tool.name).toBe("web_fetch");
    expect(tool.description).toBeTruthy();
    expect(tool.parameters.required).toContain("url");
    expect(tool.parameters.properties).toHaveProperty("selector");
  });

  it("should fetch and strip HTML tags", async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      headers: new Map([["content-type", "text/html"]]),
      text: async () => "<html><body><h1>Title</h1><p>Hello world</p></body></html>",
    });

    const tool = createWebFetchTool({});
    const result = await tool.execute({ url: "https://example.com" }, context);

    expect(result.output).toContain("Title");
    expect(result.output).toContain("Hello world");
    expect(result.output).not.toContain("<h1>");
    expect(result.output).not.toContain("<p>");
  });

  it("should return JSON as-is", async () => {
    const mockHeaders = new Map([["content-type", "application/json"]]);
    (fetch as any).mockResolvedValue({
      ok: true,
      headers: { get: (k: string) => mockHeaders.get(k), forEach: mockHeaders.forEach.bind(mockHeaders) },
      text: async () => '{"key": "value"}',
    });

    const tool = createWebFetchTool({});
    const result = await tool.execute({ url: "https://api.example.com/data" }, context);

    expect(result.output).toContain('"key"');
    expect(result.output).toContain('"value"');
  });

  it("should handle HTTP errors", async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const tool = createWebFetchTool({});
    const result = await tool.execute({ url: "https://example.com/missing" }, context);

    expect(result.error).toContain("404");
  });

  it("should handle fetch failures", async () => {
    (fetch as any).mockRejectedValue(new Error("Network error"));

    const tool = createWebFetchTool({});
    const result = await tool.execute({ url: "https://unreachable.test" }, context);

    expect(result.error).toContain("Network error");
  });

  it("should strip script and style tags", async () => {
    const mockHeaders = new Map([["content-type", "text/html"]]);
    (fetch as any).mockResolvedValue({
      ok: true,
      headers: { get: (k: string) => mockHeaders.get(k), forEach: mockHeaders.forEach.bind(mockHeaders) },
      text: async () =>
        '<html><head><style>body{color:red}</style></head><body><script>alert("xss")</script><p>Safe content</p></body></html>',
    });

    const tool = createWebFetchTool({});
    const result = await tool.execute({ url: "https://example.com" }, context);

    expect(result.output).toContain("Safe content");
    expect(result.output).not.toContain("alert");
    expect(result.output).not.toContain("color:red");
  });

  it("should truncate long responses", async () => {
    const longContent = "A".repeat(60000);
    const mockHeaders = new Map([["content-type", "text/plain"]]);
    (fetch as any).mockResolvedValue({
      ok: true,
      headers: { get: (k: string) => mockHeaders.get(k), forEach: mockHeaders.forEach.bind(mockHeaders) },
      text: async () => longContent,
    });

    const tool = createWebFetchTool({ maxLength: 100 });
    const result = await tool.execute({ url: "https://example.com/big" }, context);

    expect(result.output.length).toBeLessThan(200);
    expect(result.output).toContain("truncated");
  });
});
