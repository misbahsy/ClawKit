import { describe, it, expect, vi } from "vitest";
import createSpawnAgentTool from "../../registry/tools/spawn-agent/index.js";

describe("tool-spawn-agent", () => {
  const baseContext = { workspaceDir: ".", sessionId: "test-session" };

  it("should create a tool with correct interface", () => {
    const tool = createSpawnAgentTool({});
    expect(tool.name).toBe("spawn_agent");
    expect(tool.description).toBeTruthy();
    expect(tool.parameters.required).toContain("task");
    expect(tool.parameters.properties).toHaveProperty("model");
    expect(tool.parameters.properties).toHaveProperty("maxTurns");
  });

  it("should spawn via context.agent when available", async () => {
    const agent = vi.fn().mockResolvedValue("Sub-agent result: task completed");

    const tool = createSpawnAgentTool({});
    const result = await tool.execute(
      { task: "Summarize this document" },
      { ...baseContext, agent },
    );

    expect(agent).toHaveBeenCalledWith({
      task: "Summarize this document",
      model: undefined,
      maxTurns: 5,
      parentSession: "test-session",
    });
    expect(result.output).toContain("task completed");
  });

  it("should use config defaults for model and maxTurns", async () => {
    const agent = vi.fn().mockResolvedValue("done");

    const tool = createSpawnAgentTool({ defaultModel: "gpt-4", defaultMaxTurns: 10 });
    await tool.execute(
      { task: "analyze" },
      { ...baseContext, agent },
    );

    expect(agent).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-4",
      maxTurns: 10,
    }));
  });

  it("should allow args to override config defaults", async () => {
    const agent = vi.fn().mockResolvedValue("done");

    const tool = createSpawnAgentTool({ defaultModel: "gpt-4", defaultMaxTurns: 10 });
    await tool.execute(
      { task: "analyze", model: "claude-3", maxTurns: 3 },
      { ...baseContext, agent },
    );

    expect(agent).toHaveBeenCalledWith(expect.objectContaining({
      model: "claude-3",
      maxTurns: 3,
    }));
  });

  it("should error when no agent runtime available", async () => {
    const tool = createSpawnAgentTool({});
    const result = await tool.execute(
      { task: "do something" },
      baseContext,
    );

    expect(result.error).toContain("No agent runtime available");
    expect(result.metadata?.intent).toBe("spawn_agent");
  });

  it("should handle agent errors", async () => {
    const agent = vi.fn().mockRejectedValue(new Error("Model overloaded"));

    const tool = createSpawnAgentTool({});
    const result = await tool.execute(
      { task: "analyze" },
      { ...baseContext, agent },
    );

    expect(result.error).toContain("Model overloaded");
  });

  it("should serialize object results to JSON", async () => {
    const agent = vi.fn().mockResolvedValue({ summary: "Done", tokens: 150 });

    const tool = createSpawnAgentTool({});
    const result = await tool.execute(
      { task: "analyze" },
      { ...baseContext, agent },
    );

    const parsed = JSON.parse(result.output);
    expect(parsed.summary).toBe("Done");
    expect(parsed.tokens).toBe(150);
  });
});
