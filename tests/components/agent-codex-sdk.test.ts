import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted to create the mock before vi.mock is hoisted
const { mockRun } = vi.hoisted(() => ({
  mockRun: vi.fn(),
}));

vi.mock("@openai/codex", () => ({
  CodexClient: vi.fn(() => ({
    run: mockRun,
  })),
}));

import createCodexSdkAgent from "../../registry/agents/codex-sdk/index.js";

describe("agent-codex-sdk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have correct agent name", () => {
    const agent = createCodexSdkAgent({});
    expect(agent.name).toBe("agent-codex-sdk");
  });

  it("should handle string response", async () => {
    mockRun.mockResolvedValue("Hello from Codex!");

    const agent = createCodexSdkAgent({ apiKey: "test-key" });
    const events = [];

    for await (const event of agent.run({
      systemPrompt: "You are helpful",
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
    })) {
      events.push(event);
    }

    expect(events.find((e) => e.type === "text_done")).toBeDefined();
    expect((events.find((e) => e.type === "text_done") as any).text).toBe("Hello from Codex!");
    expect(events.find((e) => e.type === "done")).toBeDefined();
  });

  it("should handle object response with text field", async () => {
    mockRun.mockResolvedValue({ text: "Response text" });

    const agent = createCodexSdkAgent({ apiKey: "test-key" });
    const events = [];

    for await (const event of agent.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: [],
    })) {
      events.push(event);
    }

    expect((events.find((e) => e.type === "text_done") as any).text).toBe("Response text");
  });

  it("should handle object response with content field", async () => {
    mockRun.mockResolvedValue({ content: "Content text" });

    const agent = createCodexSdkAgent({ apiKey: "test-key" });
    const events = [];

    for await (const event of agent.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: [],
    })) {
      events.push(event);
    }

    expect((events.find((e) => e.type === "text_done") as any).text).toBe("Content text");
  });

  it("should handle SDK errors gracefully", async () => {
    mockRun.mockRejectedValue(new Error("Codex connection failed"));

    const agent = createCodexSdkAgent({ apiKey: "test-key" });
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

  it("should support abort", () => {
    const agent = createCodexSdkAgent({});
    expect(() => agent.abort()).not.toThrow();
  });
});
