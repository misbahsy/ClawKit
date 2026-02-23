import { describe, it, expect, vi } from "vitest";
import createMemoryWriteTool from "../../registry/tools/memory-write/index.js";

describe("tool-memory-write", () => {
  const baseContext = { workspaceDir: ".", sessionId: "test-session" };

  it("should create a tool with correct interface", () => {
    const tool = createMemoryWriteTool({});
    expect(tool.name).toBe("memory_write");
    expect(tool.description).toBeTruthy();
    expect(tool.parameters.required).toContain("content");
    expect(tool.parameters.properties).toHaveProperty("tags");
    expect(tool.parameters.properties).toHaveProperty("sessionId");
  });

  it("should delegate to sendMessage when available", async () => {
    const sendMessage = vi.fn().mockResolvedValue("Saved successfully");

    const tool = createMemoryWriteTool({});
    const result = await tool.execute(
      { content: "Important fact about the project" },
      { ...baseContext, sendMessage },
    );

    expect(sendMessage).toHaveBeenCalledWith("memory", {
      action: "write",
      content: "Important fact about the project",
      tags: [],
      sessionId: "test-session",
    });
    expect(result.output).toContain("Saved successfully");
  });

  it("should pass tags to sendMessage", async () => {
    const sendMessage = vi.fn().mockResolvedValue("ok");

    const tool = createMemoryWriteTool({});
    await tool.execute(
      { content: "API key rotation needed", tags: ["security", "ops"] },
      { ...baseContext, sendMessage },
    );

    expect(sendMessage).toHaveBeenCalledWith("memory", expect.objectContaining({
      tags: ["security", "ops"],
    }));
  });

  it("should return intent when no sendMessage available", async () => {
    const tool = createMemoryWriteTool({});
    const result = await tool.execute(
      { content: "Save this", tags: ["note"] },
      baseContext,
    );

    const parsed = JSON.parse(result.output);
    expect(parsed.intent).toBe("memory_write");
    expect(parsed.content).toBe("Save this");
    expect(parsed.tags).toEqual(["note"]);
    expect(result.metadata?.delegated).toBe(false);
  });

  it("should use custom sessionId if provided", async () => {
    const sendMessage = vi.fn().mockResolvedValue("ok");

    const tool = createMemoryWriteTool({});
    await tool.execute(
      { content: "data", sessionId: "custom-session" },
      { ...baseContext, sendMessage },
    );

    expect(sendMessage).toHaveBeenCalledWith("memory", expect.objectContaining({
      sessionId: "custom-session",
    }));
  });

  it("should handle sendMessage errors", async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error("Storage full"));

    const tool = createMemoryWriteTool({});
    const result = await tool.execute(
      { content: "data" },
      { ...baseContext, sendMessage },
    );

    expect(result.error).toContain("Storage full");
  });
});
