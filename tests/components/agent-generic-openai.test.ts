import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import createGenericOpenAIAgent from "../../registry/agents/generic-openai/index.js";

function makeSSEResponse(chunks: any[]): Response {
  const lines = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("agent-generic-openai", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should have correct agent name", () => {
    const agent = createGenericOpenAIAgent({ apiKey: "test-key" });
    expect(agent.name).toBe("agent-generic-openai");
  });

  it("should have run and abort methods", () => {
    const agent = createGenericOpenAIAgent({ apiKey: "test-key" });
    expect(typeof agent.run).toBe("function");
    expect(typeof agent.abort).toBe("function");
  });

  it("should generate text via streaming SSE", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      makeSSEResponse([
        { choices: [{ delta: { content: "Hello" } }] },
        { choices: [{ delta: { content: " from generic!" } }] },
        { choices: [{ delta: {} }] },
      ]),
    ) as any;

    const agent = createGenericOpenAIAgent({
      apiKey: "test-key",
      baseUrl: "http://localhost:8080",
    });
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
    expect(textDeltas[1].text).toBe(" from generic!");

    expect(events.find((e) => e.type === "text_done")).toBeDefined();
    expect((events.find((e) => e.type === "text_done") as any).text).toBe("Hello from generic!");
    expect(events.find((e) => e.type === "done")).toBeDefined();
  });

  it("should send request to configured baseUrl", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      makeSSEResponse([
        { choices: [{ delta: { content: "ok" } }] },
        { choices: [{ delta: {} }] },
      ]),
    ) as any;

    const agent = createGenericOpenAIAgent({
      apiKey: "my-key",
      baseUrl: "http://my-server:9999",
      model: "my-model",
    });

    for await (const _ of agent.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: [],
    })) { /* consume */ }

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[0]).toBe("http://my-server:9999/v1/chat/completions");
    expect(fetchCall[1].headers.Authorization).toBe("Bearer my-key");

    const body = JSON.parse(fetchCall[1].body);
    expect(body.model).toBe("my-model");
    expect(body.stream).toBe(true);
  });

  it("should handle tool calling via streaming", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return makeSSEResponse([
          {
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  id: "tc_1",
                  function: { name: "bash", arguments: '{"command":"ls"}' },
                }],
              },
            }],
          },
          { choices: [{ delta: {} }] },
        ]);
      }
      return makeSSEResponse([
        { choices: [{ delta: { content: "Files listed." } }] },
        { choices: [{ delta: {} }] },
      ]);
    }) as any;

    const agent = createGenericOpenAIAgent({ apiKey: "test-key", baseUrl: "http://localhost:8080" });
    const events: any[] = [];

    for await (const event of agent.run({
      systemPrompt: "You are helpful",
      messages: [{ role: "user", content: "List files" }],
      tools: [{ name: "bash", description: "Run bash", parameters: {} }],
      toolExecutor: async (name, input) => ({ output: "file1.txt" }),
    })) {
      events.push(event);
    }

    expect(events.find((e) => e.type === "tool_use")).toBeDefined();
    expect((events.find((e) => e.type === "tool_use") as any).name).toBe("bash");
    expect(events.find((e) => e.type === "tool_result")).toBeDefined();
    expect(events.find((e) => e.type === "text_done")).toBeDefined();
    expect(events.find((e) => e.type === "done")).toBeDefined();
  });

  it("should handle API errors", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    ) as any;

    const agent = createGenericOpenAIAgent({ apiKey: "bad-key", baseUrl: "http://localhost:8080" });
    await expect(async () => {
      for await (const _ of agent.run({
        systemPrompt: "test",
        messages: [{ role: "user", content: "test" }],
        tools: [],
      })) { /* consume */ }
    }).rejects.toThrow("API error 401");
  });

  it("should not throw on abort before run", () => {
    const agent = createGenericOpenAIAgent({ apiKey: "test" });
    expect(() => agent.abort()).not.toThrow();
  });

  it("should omit Authorization header when no apiKey", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      makeSSEResponse([
        { choices: [{ delta: { content: "ok" } }] },
        { choices: [{ delta: {} }] },
      ]),
    ) as any;

    const agent = createGenericOpenAIAgent({ apiKey: "", baseUrl: "http://localhost:11434" });
    for await (const _ of agent.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: [],
    })) { /* consume */ }

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers.Authorization).toBeUndefined();
  });
});
