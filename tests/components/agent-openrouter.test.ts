import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import createOpenRouterAgent from "../../registry/agents/openrouter/index.js";

describe("agent-openrouter", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should have correct agent name", () => {
    const agent = createOpenRouterAgent({ apiKey: "test-key" });
    expect(agent.name).toBe("agent-openrouter");
  });

  it("should generate text response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: { content: "Hello from OpenRouter!", tool_calls: [] },
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    }) as any;

    const agent = createOpenRouterAgent({ apiKey: "test-key" });
    const events = [];

    for await (const event of agent.run({
      systemPrompt: "You are helpful",
      messages: [{ role: "user", content: "Hello" }],
      tools: [],
    })) {
      events.push(event);
    }

    expect(events.find((e) => e.type === "text_done")).toBeDefined();
    expect((events.find((e) => e.type === "text_done") as any).text).toBe("Hello from OpenRouter!");
    expect(events.find((e) => e.type === "done")).toBeDefined();
  });

  it("should handle tool calling loop", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: null,
                tool_calls: [{
                  id: "tc_1",
                  type: "function",
                  function: { name: "bash", arguments: '{"command":"ls"}' },
                }],
              },
            }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: { content: "Done! Files listed.", tool_calls: [] },
          }],
          usage: { prompt_tokens: 20, completion_tokens: 10 },
        }),
      };
    }) as any;

    const agent = createOpenRouterAgent({ apiKey: "test-key" });
    const events = [];

    for await (const event of agent.run({
      systemPrompt: "You are helpful",
      messages: [{ role: "user", content: "List files" }],
      tools: [{ name: "bash", description: "Run bash", parameters: {} }],
      toolExecutor: async (name, input) => ({ output: "file1.txt\nfile2.txt" }),
    })) {
      events.push(event);
    }

    expect(events.find((e) => e.type === "tool_use")).toBeDefined();
    expect(events.find((e) => e.type === "tool_result")).toBeDefined();
    expect(events.find((e) => e.type === "text_done")).toBeDefined();
  });

  it("should send correct headers", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 5, completion_tokens: 5 },
      }),
    }) as any;

    const agent = createOpenRouterAgent({ apiKey: "test-key-123" });
    for await (const _ of agent.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: [],
    })) { /* consume */ }

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[0]).toContain("openrouter.ai");
    expect(fetchCall[1].headers.Authorization).toBe("Bearer test-key-123");
  });

  it("should handle API errors", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    }) as any;

    const agent = createOpenRouterAgent({ apiKey: "bad-key" });
    await expect(async () => {
      for await (const _ of agent.run({
        systemPrompt: "test",
        messages: [{ role: "user", content: "test" }],
        tools: [],
      })) { /* consume */ }
    }).rejects.toThrow("OpenRouter API error 401");
  });

  it("should support abort", () => {
    const agent = createOpenRouterAgent({ apiKey: "test" });
    expect(() => agent.abort()).not.toThrow();
  });
});
