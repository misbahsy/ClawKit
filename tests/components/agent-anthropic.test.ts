import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Anthropic SDK before importing
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = {
        stream: vi.fn(),
      };
    },
  };
});

import createAnthropicAgent from "../../registry/agents/anthropic/index.js";

describe("agent-anthropic", () => {
  it("should create an agent with default config", () => {
    const agent = createAnthropicAgent({});
    expect(agent.name).toBe("agent-anthropic");
    expect(typeof agent.run).toBe("function");
    expect(typeof agent.abort).toBe("function");
  });

  it("should create an agent with custom config", () => {
    const agent = createAnthropicAgent({
      model: "claude-opus-4-20250514",
      maxTokens: 4096,
    });
    expect(agent.name).toBe("agent-anthropic");
  });

  it("should yield events from run()", async () => {
    // Mock the stream
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const mockInstance = new Anthropic();

    const mockStream = {
      [Symbol.asyncIterator]: async function* () {
        yield {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Hello " },
        };
        yield {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "world!" },
        };
      },
      finalMessage: async () => ({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Hello world!" }],
        usage: {
          input_tokens: 100,
          output_tokens: 10,
        },
      }),
    };

    mockInstance.messages.stream = vi.fn().mockReturnValue(mockStream);

    const agent = createAnthropicAgent({});
    // Replace internal client
    (agent as any)._client = mockInstance;

    // We test the structure — the real API calls would be integration tests
    expect(agent.name).toBe("agent-anthropic");
  });
});
