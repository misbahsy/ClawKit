import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSend, mockBedrockRuntimeClient, mockInvokeCommand } = vi.hoisted(() => {
  const mockSend = vi.fn();
  const mockBedrockRuntimeClient = vi.fn(() => ({ send: mockSend }));
  const mockInvokeCommand = vi.fn((input: any) => ({ input }));
  return { mockSend, mockBedrockRuntimeClient, mockInvokeCommand };
});

vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: mockBedrockRuntimeClient,
  InvokeModelWithResponseStreamCommand: mockInvokeCommand,
}));

import createBedrockAgent from "../../registry/agents/bedrock/index.js";

function makeStreamBody(events: any[]): AsyncIterable<{ chunk?: { bytes: Uint8Array } }> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield {
          chunk: {
            bytes: new TextEncoder().encode(JSON.stringify(event)),
          },
        };
      }
    },
  };
}

describe("agent-bedrock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have correct agent name", () => {
    const agent = createBedrockAgent({});
    expect(agent.name).toBe("agent-bedrock");
  });

  it("should generate text response", async () => {
    mockSend.mockResolvedValue({
      body: makeStreamBody([
        { type: "message_start", message: { usage: { input_tokens: 10 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello from Bedrock!" } },
        { type: "message_delta", message: { stop_reason: "end_turn", usage: { output_tokens: 5 } } },
      ]),
    });

    const agent = createBedrockAgent({});
    const events: any[] = [];

    for await (const event of agent.run({
      systemPrompt: "You are helpful",
      messages: [{ role: "user", content: "Hello" }],
      tools: [],
    })) {
      events.push(event);
    }

    expect(events.find((e) => e.type === "text_delta")).toBeDefined();
    expect((events.find((e) => e.type === "text_delta") as any).text).toBe("Hello from Bedrock!");
    expect(events.find((e) => e.type === "text_done")).toBeDefined();
    expect((events.find((e) => e.type === "text_done") as any).text).toBe("Hello from Bedrock!");
    expect(events.find((e) => e.type === "done")).toBeDefined();
  });

  it("should handle tool use blocks", async () => {
    let callCount = 0;
    mockSend.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          body: makeStreamBody([
            { type: "message_start", message: { usage: { input_tokens: 10 } } },
            {
              type: "content_block_start",
              index: 0,
              content_block: { type: "tool_use", id: "tu_1", name: "bash" },
            },
            {
              type: "content_block_delta",
              index: 0,
              delta: { type: "input_json_delta", partial_json: '{"command":"ls"}' },
            },
            { type: "message_delta", message: { stop_reason: "tool_use", usage: { output_tokens: 10 } } },
          ]),
        };
      }
      return {
        body: makeStreamBody([
          { type: "message_start", message: { usage: { input_tokens: 20 } } },
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Files listed." } },
          { type: "message_delta", message: { stop_reason: "end_turn", usage: { output_tokens: 5 } } },
        ]),
      };
    });

    const agent = createBedrockAgent({});
    const events: any[] = [];

    for await (const event of agent.run({
      systemPrompt: "You are helpful",
      messages: [{ role: "user", content: "List files" }],
      tools: [{ name: "bash", description: "Run bash", parameters: {} }],
      toolExecutor: async (_name, _input) => ({ output: "file1.txt" }),
    })) {
      events.push(event);
    }

    expect(events.find((e) => e.type === "tool_use")).toBeDefined();
    expect((events.find((e) => e.type === "tool_use") as any).name).toBe("bash");
    expect((events.find((e) => e.type === "tool_use") as any).input).toEqual({ command: "ls" });
    expect(events.find((e) => e.type === "tool_result")).toBeDefined();
    expect(events.find((e) => e.type === "text_done")).toBeDefined();
  });

  it("should track usage from invocation metrics", async () => {
    mockSend.mockResolvedValue({
      body: makeStreamBody([
        { type: "message_start", message: { usage: { input_tokens: 0 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
        {
          "type": "message_delta",
          "message": { stop_reason: "end_turn", usage: { output_tokens: 0 } },
          "amazon-bedrock-invocationMetrics": { inputTokenCount: 42, outputTokenCount: 7 },
        },
      ]),
    });

    const agent = createBedrockAgent({});
    const events: any[] = [];

    for await (const event of agent.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: [],
    })) {
      events.push(event);
    }

    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    expect(done.usage.inputTokens).toBe(42);
    expect(done.usage.outputTokens).toBe(7);
  });

  it("should use default model", async () => {
    mockSend.mockResolvedValue({
      body: makeStreamBody([
        { type: "message_start", message: { usage: { input_tokens: 0 } } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
        { type: "message_delta", message: { stop_reason: "end_turn", usage: { output_tokens: 0 } } },
      ]),
    });

    const agent = createBedrockAgent({});
    for await (const _ of agent.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: [],
    })) { /* consume */ }

    expect(mockInvokeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "anthropic.claude-3-sonnet-20240229-v1:0",
      }),
    );
  });

  it("should configure custom region", () => {
    createBedrockAgent({ region: "eu-west-1" });

    expect(mockBedrockRuntimeClient).toHaveBeenCalledWith(
      expect.objectContaining({ region: "eu-west-1" }),
    );
  });

  it("should pass credentials when provided", () => {
    const creds = {
      accessKeyId: "AKID",
      secretAccessKey: "SECRET",
      sessionToken: "TOKEN",
    };
    createBedrockAgent({ credentials: creds });

    expect(mockBedrockRuntimeClient).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: creds }),
    );
  });

  it("should support abort", () => {
    const agent = createBedrockAgent({});
    expect(() => agent.abort()).not.toThrow();
  });

  it("should handle empty stream", async () => {
    mockSend.mockResolvedValue({
      body: makeStreamBody([
        { type: "message_start", message: { usage: { input_tokens: 0 } } },
        { type: "message_delta", message: { stop_reason: "end_turn", usage: { output_tokens: 0 } } },
      ]),
    });

    const agent = createBedrockAgent({});
    const events: any[] = [];

    for await (const event of agent.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: [],
    })) {
      events.push(event);
    }

    expect(events.find((e) => e.type === "done")).toBeDefined();
  });
});
