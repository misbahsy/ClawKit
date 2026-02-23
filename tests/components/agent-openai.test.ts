import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock openai SDK
const mockCreate = vi.fn();

vi.mock("openai", () => ({
  default: vi.fn(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  })),
}));

import createOpenAIAgent from "../../registry/agents/openai/index.js";

function makeStreamChunks(chunks: any[]): AsyncIterable<any> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

describe("agent-openai", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have correct agent name", () => {
    const agent = createOpenAIAgent({ apiKey: "test-key" });
    expect(agent.name).toBe("agent-openai");
  });

  it("should have run and abort methods", () => {
    const agent = createOpenAIAgent({ apiKey: "test-key" });
    expect(typeof agent.run).toBe("function");
    expect(typeof agent.abort).toBe("function");
  });

  it("should yield text events from streaming", async () => {
    mockCreate.mockResolvedValue(
      makeStreamChunks([
        { choices: [{ delta: { content: "Hello" } }] },
        { choices: [{ delta: { content: " world!" } }] },
        { choices: [{ delta: {} }] },
      ]),
    );

    const agent = createOpenAIAgent({ apiKey: "test-key", model: "gpt-4o" });
    const events: any[] = [];

    for await (const event of agent.run({
      systemPrompt: "You are helpful",
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
    })) {
      events.push(event);
    }

    const textDeltas = events.filter((e) => e.type === "text_delta");
    expect(textDeltas).toHaveLength(2);
    expect(textDeltas[0].text).toBe("Hello");
    expect(textDeltas[1].text).toBe(" world!");

    expect(events.find((e) => e.type === "text_done")).toBeDefined();
    expect((events.find((e) => e.type === "text_done") as any).text).toBe("Hello world!");
    expect(events.find((e) => e.type === "done")).toBeDefined();
  });

  it("should handle tool calling", async () => {
    let callCount = 0;
    mockCreate.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return makeStreamChunks([
          {
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  id: "call_1",
                  function: { name: "bash", arguments: '{"command' },
                }],
              },
            }],
          },
          {
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  function: { arguments: '":"ls"}' },
                }],
              },
            }],
          },
          { choices: [{ delta: {} }] },
        ]);
      }
      return makeStreamChunks([
        { choices: [{ delta: { content: "Done!" } }] },
        { choices: [{ delta: {} }] },
      ]);
    });

    const agent = createOpenAIAgent({ apiKey: "test-key" });
    const events: any[] = [];

    for await (const event of agent.run({
      systemPrompt: "You are helpful",
      messages: [{ role: "user", content: "List files" }],
      tools: [{ name: "bash", description: "Run bash", parameters: {} }],
      toolExecutor: async (name, input) => ({ output: "file1.txt\nfile2.txt" }),
    })) {
      events.push(event);
    }

    const toolUse = events.find((e) => e.type === "tool_use");
    expect(toolUse).toBeDefined();
    expect(toolUse.name).toBe("bash");
    expect(toolUse.input).toEqual({ command: "ls" });

    const toolResult = events.find((e) => e.type === "tool_result");
    expect(toolResult).toBeDefined();
    expect(toolResult.output).toBe("file1.txt\nfile2.txt");

    expect(events.find((e) => e.type === "text_done")).toBeDefined();
    expect(events.find((e) => e.type === "done")).toBeDefined();
  });

  it("should not throw on abort before run", () => {
    const agent = createOpenAIAgent({ apiKey: "test-key" });
    expect(() => agent.abort()).not.toThrow();
  });

  it("should pass tools to the API when provided", async () => {
    mockCreate.mockResolvedValue(
      makeStreamChunks([
        { choices: [{ delta: { content: "ok" } }] },
        { choices: [{ delta: {} }] },
      ]),
    );

    const agent = createOpenAIAgent({ apiKey: "test-key" });
    for await (const _ of agent.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: [{ name: "test_tool", description: "A test tool", parameters: { type: "object" } }],
    })) { /* consume */ }

    const createCall = mockCreate.mock.calls[0];
    expect(createCall[0].tools).toBeDefined();
    expect(createCall[0].tools[0].function.name).toBe("test_tool");
  });
});
