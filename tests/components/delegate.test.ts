import { describe, it, expect, vi } from "vitest";
import createDelegateTool from "../../registry/tools/delegate/index.js";

describe("tool-delegate", () => {
  const baseContext = { workspaceDir: ".", sessionId: "test-session" };

  it("should create a tool with correct interface", () => {
    const tool = createDelegateTool({});
    expect(tool.name).toBe("delegate");
    expect(tool.description).toBeTruthy();
    expect(tool.parameters.required).toContain("task");
    expect(tool.parameters.properties).toHaveProperty("runtime");
    expect(tool.parameters.properties).toHaveProperty("model");
  });

  it("should delegate via sendMessage when available", async () => {
    const sendMessage = vi.fn().mockResolvedValue("Delegated result: analysis complete");

    const tool = createDelegateTool({});
    const result = await tool.execute(
      { task: "Analyze this data", runtime: "openrouter" },
      { ...baseContext, sendMessage },
    );

    expect(sendMessage).toHaveBeenCalledWith("openrouter", {
      action: "delegate",
      task: "Analyze this data",
      model: undefined,
      fromSession: "test-session",
    });
    expect(result.output).toContain("analysis complete");
    expect(result.metadata?.delegated).toBe(true);
  });

  it("should fall back to context.agent when sendMessage not available", async () => {
    const agent = vi.fn().mockResolvedValue("Agent result");

    const tool = createDelegateTool({});
    const result = await tool.execute(
      { task: "process data", runtime: "local" },
      { ...baseContext, agent },
    );

    expect(agent).toHaveBeenCalledWith(expect.objectContaining({
      task: "process data",
      runtime: "local",
    }));
    expect(result.output).toContain("Agent result");
    expect(result.metadata?.delegated).toBe(true);
  });

  it("should use config defaults", async () => {
    const sendMessage = vi.fn().mockResolvedValue("ok");

    const tool = createDelegateTool({ defaultRuntime: "anthropic", defaultModel: "claude-3-opus" });
    await tool.execute(
      { task: "summarize" },
      { ...baseContext, sendMessage },
    );

    expect(sendMessage).toHaveBeenCalledWith("anthropic", expect.objectContaining({
      model: "claude-3-opus",
    }));
  });

  it("should allow args to override config defaults", async () => {
    const sendMessage = vi.fn().mockResolvedValue("ok");

    const tool = createDelegateTool({ defaultRuntime: "anthropic", defaultModel: "claude-3-opus" });
    await tool.execute(
      { task: "summarize", runtime: "ollama", model: "llama3" },
      { ...baseContext, sendMessage },
    );

    expect(sendMessage).toHaveBeenCalledWith("ollama", expect.objectContaining({
      model: "llama3",
    }));
  });

  it("should error when neither sendMessage nor agent available", async () => {
    const tool = createDelegateTool({});
    const result = await tool.execute(
      { task: "do something" },
      baseContext,
    );

    expect(result.error).toContain("No delegation runtime available");
    expect(result.metadata?.intent).toBe("delegate");
  });

  it("should handle delegation errors", async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error("Runtime offline"));

    const tool = createDelegateTool({});
    const result = await tool.execute(
      { task: "analyze" },
      { ...baseContext, sendMessage },
    );

    expect(result.error).toContain("Runtime offline");
  });

  it("should serialize object results to JSON", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ status: "done", tokens: 200 });

    const tool = createDelegateTool({});
    const result = await tool.execute(
      { task: "process" },
      { ...baseContext, sendMessage },
    );

    const parsed = JSON.parse(result.output);
    expect(parsed.status).toBe("done");
  });
});
