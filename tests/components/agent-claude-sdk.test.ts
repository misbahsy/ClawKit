import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted to create the mock before vi.mock is hoisted
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-code", () => ({
  query: mockQuery,
}));

import createClaudeSdkAgent from "../../registry/agents/claude-sdk/index.js";

describe("agent-claude-sdk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have correct agent name", () => {
    const agent = createClaudeSdkAgent({});
    expect(agent.name).toBe("agent-claude-sdk");
  });

  it("should handle string response from SDK", async () => {
    mockQuery.mockResolvedValue("Hello from Claude SDK!");

    const agent = createClaudeSdkAgent({ model: "claude-sonnet-4-20250514" });
    const events = [];

    for await (const event of agent.run({
      systemPrompt: "You are helpful",
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
    })) {
      events.push(event);
    }

    expect(events.find((e) => e.type === "text_done")).toBeDefined();
    expect((events.find((e) => e.type === "text_done") as any).text).toBe("Hello from Claude SDK!");
    expect(events.find((e) => e.type === "done")).toBeDefined();
  });

  it("should handle array response with text blocks", async () => {
    mockQuery.mockResolvedValue([
      { type: "text", text: "Part 1 " },
      { type: "text", text: "Part 2" },
    ]);

    const agent = createClaudeSdkAgent({});
    const events = [];

    for await (const event of agent.run({
      systemPrompt: "You are helpful",
      messages: [{ role: "user", content: "Hello" }],
      tools: [],
    })) {
      events.push(event);
    }

    expect((events.find((e) => e.type === "text_done") as any).text).toBe("Part 1 Part 2");
  });

  it("should handle tool use blocks in response", async () => {
    mockQuery.mockResolvedValue([
      { type: "tool_use", id: "tu_1", name: "bash", input: { command: "ls" } },
      { type: "text", text: "Done" },
    ]);

    const agent = createClaudeSdkAgent({});
    const events = [];

    for await (const event of agent.run({
      systemPrompt: "You are helpful",
      messages: [{ role: "user", content: "List files" }],
      tools: [{ name: "bash", description: "Run bash", parameters: {} }],
      toolExecutor: async () => ({ output: "file.txt" }),
    })) {
      events.push(event);
    }

    expect(events.find((e) => e.type === "tool_use")).toBeDefined();
    expect(events.find((e) => e.type === "tool_result")).toBeDefined();
  });

  it("should handle SDK errors gracefully", async () => {
    mockQuery.mockRejectedValue(new Error("SDK connection failed"));

    const agent = createClaudeSdkAgent({});
    const events = [];

    for await (const event of agent.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: [],
    })) {
      events.push(event);
    }

    expect(events.find((e) => e.type === "error")).toBeDefined();
    expect(events.find((e) => e.type === "done")).toBeDefined();
  });

  it("should call query with correct parameters", async () => {
    mockQuery.mockResolvedValue("ok");

    const agent = createClaudeSdkAgent({ model: "claude-sonnet-4-20250514" });
    for await (const _ of agent.run({
      systemPrompt: "Be helpful",
      messages: [{ role: "user", content: "Hello" }],
      tools: [],
    })) { /* consume */ }

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Hello",
        systemPrompt: "Be helpful",
      })
    );
  });

  it("should support abort", () => {
    const agent = createClaudeSdkAgent({});
    expect(() => agent.abort()).not.toThrow();
  });
});
