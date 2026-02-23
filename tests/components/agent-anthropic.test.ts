import { describe, it, expect, vi } from "vitest";

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(() => ({ messages: { stream: vi.fn() } })),
}));

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

  it("should not throw on abort", () => {
    const agent = createAnthropicAgent({});
    expect(() => agent.abort()).not.toThrow();
  });
});
