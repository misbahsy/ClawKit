import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import createDeepSeekAgent from "../../registry/agents/deepseek/index.js";

describe("agent-deepseek", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function makeSSEResponse(events: Array<{ content?: string; tool_calls?: any[] }>): Response {
    const lines = events.map((e) => {
      const choice: any = { delta: {} };
      if (e.content !== undefined) choice.delta.content = e.content;
      if (e.tool_calls) choice.delta.tool_calls = e.tool_calls;
      return `data: ${JSON.stringify({ choices: [choice] })}`;
    });
    lines.push("data: [DONE]");
    const body = lines.join("\n") + "\n";

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(body));
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  it("should have correct agent name", () => {
    const agent = createDeepSeekAgent({ apiKey: "test-key" });
    expect(agent.name).toBe("agent-deepseek");
  });

  it("should generate text response via SSE streaming", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      makeSSEResponse([
        { content: "Hello " },
        { content: "from DeepSeek!" },
      ]),
    ) as any;

    const agent = createDeepSeekAgent({ apiKey: "test-key" });
    const events: any[] = [];

    for await (const event of agent.run({
      systemPrompt: "You are helpful",
      messages: [{ role: "user", content: "Hello" }],
      tools: [],
    })) {
      events.push(event);
    }

    expect(events.find((e) => e.type === "text_delta")).toBeDefined();
    expect((events.find((e) => e.type === "text_done") as any).text).toBe("Hello from DeepSeek!");
    expect(events.find((e) => e.type === "done")).toBeDefined();
  });

  it("should handle tool calling loop", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return makeSSEResponse([
          {
            tool_calls: [{
              index: 0,
              id: "tc_1",
              type: "function",
              function: { name: "bash", arguments: '{"command":"ls"}' },
            }],
          },
        ]);
      }
      return makeSSEResponse([
        { content: "Done! Files listed." },
      ]);
    }) as any;

    const agent = createDeepSeekAgent({ apiKey: "test-key" });
    const events: any[] = [];

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

  it("should send correct headers and use base URL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      makeSSEResponse([{ content: "ok" }]),
    ) as any;

    const agent = createDeepSeekAgent({ apiKey: "test-key-123", baseUrl: "https://custom.deepseek.com" });
    for await (const _ of agent.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: [],
    })) { /* consume */ }

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[0]).toBe("https://custom.deepseek.com/v1/chat/completions");
    expect(fetchCall[1].headers.Authorization).toBe("Bearer test-key-123");
  });

  it("should use default base URL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      makeSSEResponse([{ content: "ok" }]),
    ) as any;

    const agent = createDeepSeekAgent({ apiKey: "test-key" });
    for await (const _ of agent.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: [],
    })) { /* consume */ }

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[0]).toBe("https://api.deepseek.com/v1/chat/completions");
  });

  it("should handle API errors", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    }) as any;

    const agent = createDeepSeekAgent({ apiKey: "bad-key" });
    await expect(async () => {
      for await (const _ of agent.run({
        systemPrompt: "test",
        messages: [{ role: "user", content: "test" }],
        tools: [],
      })) { /* consume */ }
    }).rejects.toThrow("DeepSeek API error 401");
  });

  it("should handle no response body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: null,
    }) as any;

    const agent = createDeepSeekAgent({ apiKey: "test-key" });
    await expect(async () => {
      for await (const _ of agent.run({
        systemPrompt: "test",
        messages: [{ role: "user", content: "test" }],
        tools: [],
      })) { /* consume */ }
    }).rejects.toThrow("No response body");
  });

  it("should enable streaming in request body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      makeSSEResponse([{ content: "ok" }]),
    ) as any;

    const agent = createDeepSeekAgent({ apiKey: "test-key" });
    for await (const _ of agent.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: [],
    })) { /* consume */ }

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.stream).toBe(true);
  });

  it("should use default model deepseek-chat", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      makeSSEResponse([{ content: "ok" }]),
    ) as any;

    const agent = createDeepSeekAgent({ apiKey: "test-key" });
    for await (const _ of agent.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: [],
    })) { /* consume */ }

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.model).toBe("deepseek-chat");
  });

  it("should accumulate tool call arguments across SSE chunks", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return makeSSEResponse([
          {
            tool_calls: [{
              index: 0,
              id: "tc_1",
              type: "function",
              function: { name: "read", arguments: '{"path":' },
            }],
          },
          {
            tool_calls: [{
              index: 0,
              function: { arguments: '"test.ts"}' },
            }],
          },
        ]);
      }
      return makeSSEResponse([{ content: "Done" }]);
    }) as any;

    const agent = createDeepSeekAgent({ apiKey: "test-key" });
    const events: any[] = [];

    for await (const event of agent.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: [{ name: "read", description: "Read file", parameters: {} }],
      toolExecutor: async (name, input) => ({ output: "content" }),
    })) {
      events.push(event);
    }

    const toolUse = events.find((e) => e.type === "tool_use");
    expect(toolUse).toBeDefined();
    expect(toolUse.input).toEqual({ path: "test.ts" });
  });

  it("should support abort", () => {
    const agent = createDeepSeekAgent({ apiKey: "test" });
    expect(() => agent.abort()).not.toThrow();
  });
});
