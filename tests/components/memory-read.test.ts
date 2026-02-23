import { describe, it, expect, vi } from "vitest";
import createMemoryReadTool from "../../registry/tools/memory-read/index.js";

describe("tool-memory-read", () => {
  const baseContext = { workspaceDir: ".", sessionId: "test-session" };

  it("should create a tool with correct interface", () => {
    const tool = createMemoryReadTool({});
    expect(tool.name).toBe("memory_read");
    expect(tool.description).toBeTruthy();
    expect(tool.parameters.required).toContain("query");
    expect(tool.parameters.properties).toHaveProperty("limit");
    expect(tool.parameters.properties).toHaveProperty("sessionId");
  });

  it("should delegate to sendMessage when available", async () => {
    const sendMessage = vi.fn().mockResolvedValue([
      { content: "Previous conversation about TypeScript", score: 0.95 },
    ]);

    const tool = createMemoryReadTool({});
    const result = await tool.execute(
      { query: "TypeScript" },
      { ...baseContext, sendMessage },
    );

    expect(sendMessage).toHaveBeenCalledWith("memory", {
      action: "search",
      query: "TypeScript",
      limit: 10,
      sessionId: "test-session",
    });
    expect(result.output).toContain("TypeScript");
  });

  it("should return intent when no sendMessage available", async () => {
    const tool = createMemoryReadTool({});
    const result = await tool.execute({ query: "test query" }, baseContext);

    const parsed = JSON.parse(result.output);
    expect(parsed.intent).toBe("memory_search");
    expect(parsed.query).toBe("test query");
    expect(result.metadata?.delegated).toBe(false);
  });

  it("should respect custom limit", async () => {
    const sendMessage = vi.fn().mockResolvedValue("results");

    const tool = createMemoryReadTool({});
    await tool.execute(
      { query: "test", limit: 5 },
      { ...baseContext, sendMessage },
    );

    expect(sendMessage).toHaveBeenCalledWith("memory", expect.objectContaining({ limit: 5 }));
  });

  it("should use config default limit", async () => {
    const sendMessage = vi.fn().mockResolvedValue("results");

    const tool = createMemoryReadTool({ defaultLimit: 20 });
    await tool.execute(
      { query: "test" },
      { ...baseContext, sendMessage },
    );

    expect(sendMessage).toHaveBeenCalledWith("memory", expect.objectContaining({ limit: 20 }));
  });

  it("should override session ID when specified", async () => {
    const sendMessage = vi.fn().mockResolvedValue("results");

    const tool = createMemoryReadTool({});
    await tool.execute(
      { query: "test", sessionId: "other-session" },
      { ...baseContext, sendMessage },
    );

    expect(sendMessage).toHaveBeenCalledWith("memory", expect.objectContaining({ sessionId: "other-session" }));
  });

  it("should handle sendMessage errors", async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error("Memory unavailable"));

    const tool = createMemoryReadTool({});
    const result = await tool.execute(
      { query: "test" },
      { ...baseContext, sendMessage },
    );

    expect(result.error).toContain("Memory unavailable");
  });
});
