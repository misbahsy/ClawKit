import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import createWebSearchTool from "../../registry/tools/web-search/index.js";

describe("tool-web-search", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("should create a tool with correct interface", () => {
    const tool = createWebSearchTool({});
    expect(tool.name).toBe("web_search");
    expect(tool.description).toBeTruthy();
    expect(tool.parameters.required).toContain("query");
  });

  it("should route to Brave when BRAVE_API_KEY is set", async () => {
    process.env.BRAVE_API_KEY = "test-brave-key";

    const mockResponse = {
      ok: true,
      json: async () => ({
        web: {
          results: [
            { title: "Test Result", url: "https://example.com", description: "A test result" },
          ],
        },
      }),
    };
    (fetch as any).mockResolvedValue(mockResponse);

    const tool = createWebSearchTool({});
    const result = await tool.execute({ query: "test" }, { workspaceDir: ".", sessionId: "s1" });

    expect(result.output).toContain("Test Result");
    expect(result.output).toContain("https://example.com");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("api.search.brave.com"),
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Subscription-Token": "test-brave-key" }),
      }),
    );
  });

  it("should route to Tavily when TAVILY_API_KEY is set", async () => {
    process.env.TAVILY_API_KEY = "test-tavily-key";

    const mockResponse = {
      ok: true,
      json: async () => ({
        results: [
          { title: "Tavily Result", url: "https://tavily.com", content: "Tavily snippet" },
        ],
      }),
    };
    (fetch as any).mockResolvedValue(mockResponse);

    const tool = createWebSearchTool({});
    const result = await tool.execute({ query: "test" }, { workspaceDir: ".", sessionId: "s1" });

    expect(result.output).toContain("Tavily Result");
    expect(fetch).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("should route to SerpAPI when SERPAPI_API_KEY is set", async () => {
    process.env.SERPAPI_API_KEY = "test-serp-key";

    const mockResponse = {
      ok: true,
      json: async () => ({
        organic_results: [
          { title: "SerpAPI Result", link: "https://serpapi.com", snippet: "Serp snippet" },
        ],
      }),
    };
    (fetch as any).mockResolvedValue(mockResponse);

    const tool = createWebSearchTool({});
    const result = await tool.execute({ query: "test" }, { workspaceDir: ".", sessionId: "s1" });

    expect(result.output).toContain("SerpAPI Result");
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("serpapi.com"));
  });

  it("should return error when no API key is set", async () => {
    delete process.env.BRAVE_API_KEY;
    delete process.env.TAVILY_API_KEY;
    delete process.env.SERPAPI_API_KEY;

    const tool = createWebSearchTool({});
    const result = await tool.execute({ query: "test" }, { workspaceDir: ".", sessionId: "s1" });

    expect(result.error).toContain("No search API key found");
  });

  it("should handle API errors gracefully", async () => {
    process.env.BRAVE_API_KEY = "test-key";

    (fetch as any).mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    });

    const tool = createWebSearchTool({});
    const result = await tool.execute({ query: "test" }, { workspaceDir: ".", sessionId: "s1" });

    expect(result.error).toContain("Brave API error");
  });

  it("should handle empty results", async () => {
    process.env.BRAVE_API_KEY = "test-key";

    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ web: { results: [] } }),
    });

    const tool = createWebSearchTool({});
    const result = await tool.execute({ query: "obscure query" }, { workspaceDir: ".", sessionId: "s1" });

    expect(result.output).toBe("No results found.");
  });
});
