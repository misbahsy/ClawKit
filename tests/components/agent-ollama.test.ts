import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock ollama SDK
const mockChat = vi.fn();
const mockAbort = vi.fn();

vi.mock("ollama", () => ({
  Ollama: vi.fn(() => ({
    chat: mockChat,
    abort: mockAbort,
  })),
}));

import createOllamaAgent from "../../registry/agents/ollama/index.js";

describe("agent-ollama", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have correct agent name", () => {
    const agent = createOllamaAgent({});
    expect(agent.name).toBe("agent-ollama");
  });

  it("should generate text response with streaming", async () => {
    // Simulate async iterable stream
    mockChat.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield { message: { content: "Hello " } };
        yield { message: { content: "world!" } };
      },
    });

    const agent = createOllamaAgent({ model: "llama3.2" });
    const events = [];

    for await (const event of agent.run({
      systemPrompt: "You are helpful",
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
    })) {
      events.push(event);
    }

    const textDeltas = events.filter((e) => e.type === "text_delta");
    expect(textDeltas).toHaveLength(2);
    expect((textDeltas[0] as any).text).toBe("Hello ");
    expect((textDeltas[1] as any).text).toBe("world!");
    expect(events.find((e) => e.type === "text_done")).toBeDefined();
    expect(events.find((e) => e.type === "done")).toBeDefined();
  });

  it("should handle tool calls", async () => {
    let callCount = 0;
    mockChat.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          [Symbol.asyncIterator]: async function* () {
            yield {
              message: {
                content: "",
                tool_calls: [{
                  function: { name: "bash", arguments: { command: "ls" } },
                }],
              },
            };
          },
        };
      }
      return {
        [Symbol.asyncIterator]: async function* () {
          yield { message: { content: "Found files." } };
        },
      };
    });

    const agent = createOllamaAgent({});
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

  it("should pass correct model and host", async () => {
    mockChat.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield { message: { content: "ok" } };
      },
    });

    const agent = createOllamaAgent({ model: "mistral", host: "http://myhost:11434" });
    for await (const _ of agent.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: [],
    })) { /* consume */ }

    expect(mockChat).toHaveBeenCalledWith(
      expect.objectContaining({ model: "mistral", stream: true })
    );
  });

  it("should support abort", () => {
    const agent = createOllamaAgent({});
    agent.abort();
    expect(mockAbort).toHaveBeenCalled();
  });
});
