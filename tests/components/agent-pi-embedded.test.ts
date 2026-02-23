import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import createPiEmbeddedAgent from "../../registry/agents/pi-embedded/index.js";

describe("agent-pi-embedded", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function makeSSEStream(events: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const evt of events) {
          controller.enqueue(encoder.encode(`data: ${evt}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
  }

  it("should have correct agent name", () => {
    const agent = createPiEmbeddedAgent({});
    expect(agent.name).toBe("agent-pi-embedded");
  });

  it("should have run and abort functions", () => {
    const agent = createPiEmbeddedAgent({});
    expect(typeof agent.run).toBe("function");
    expect(typeof agent.abort).toBe("function");
  });

  it("should yield text_delta, text_done, and done events from streaming response", async () => {
    const sseEvents = [
      JSON.stringify({ type: "text_delta", delta: { text: "Hello " } }),
      JSON.stringify({ type: "text_delta", delta: { text: "world!" } }),
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream(sseEvents),
    }) as any;

    const agent = createPiEmbeddedAgent({ apiKey: "test-key" });
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

    const textDone = events.find((e) => e.type === "text_done");
    expect(textDone).toBeDefined();
    expect((textDone as any).text).toBe("Hello world!");

    expect(events.find((e) => e.type === "done")).toBeDefined();
  });

  it("should yield tool_use and tool_result events", async () => {
    const sseEvents = [
      JSON.stringify({
        type: "tool_use",
        tool_call: { id: "tc_1", name: "bash", input: { command: "ls" } },
      }),
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream(sseEvents),
    }) as any;

    const agent = createPiEmbeddedAgent({ apiKey: "test-key" });
    const events = [];

    for await (const event of agent.run({
      systemPrompt: "You are helpful",
      messages: [{ role: "user", content: "List files" }],
      tools: [{ name: "bash", description: "Run bash", parameters: {} }],
      toolExecutor: async (_name, _input) => ({ output: "file1.txt\nfile2.txt" }),
    })) {
      events.push(event);
    }

    const toolUse = events.find((e) => e.type === "tool_use");
    expect(toolUse).toBeDefined();
    expect((toolUse as any).name).toBe("bash");
    expect((toolUse as any).id).toBe("tc_1");

    const toolResult = events.find((e) => e.type === "tool_result");
    expect(toolResult).toBeDefined();
    expect((toolResult as any).output).toBe("file1.txt\nfile2.txt");
  });

  it("should abort without throwing", () => {
    const agent = createPiEmbeddedAgent({});
    expect(() => agent.abort()).not.toThrow();
  });

  it("should compact messages when history exceeds compactionThreshold", async () => {
    const longHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (let i = 0; i < 120; i++) {
      longHistory.push({ role: i % 2 === 0 ? "user" : "assistant", content: `Message ${i}` });
    }

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([JSON.stringify({ type: "text_delta", delta: { text: "ok" } })]),
    }) as any;

    const agent = createPiEmbeddedAgent({
      apiKey: "test-key",
      sessionManagement: true,
      compactionThreshold: 100,
    });

    for await (const _ of agent.run({
      systemPrompt: "test",
      messages: longHistory,
      tools: [],
    })) { /* consume */ }

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    // Should be compacted: 1 system summary + last 20 messages = 21
    expect(body.messages.length).toBe(21);
    expect(body.messages[0].content).toContain("[Compacted history]");
  });

  it("should not compact when messages are below threshold", async () => {
    const shortHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (let i = 0; i < 10; i++) {
      shortHistory.push({ role: i % 2 === 0 ? "user" : "assistant", content: `Message ${i}` });
    }

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([JSON.stringify({ type: "text_delta", delta: { text: "ok" } })]),
    }) as any;

    const agent = createPiEmbeddedAgent({ apiKey: "test-key" });

    for await (const _ of agent.run({
      systemPrompt: "test",
      messages: shortHistory,
      tools: [],
    })) { /* consume */ }

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.messages.length).toBe(10);
  });

  it("should try failover models when primary fails", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, opts: any) => {
      callCount++;
      const reqBody = JSON.parse(opts.body);
      if (reqBody.model === "pi-default") {
        return { ok: false, status: 503 };
      }
      // Failover model succeeds
      return {
        ok: true,
        body: makeSSEStream([JSON.stringify({ type: "text_delta", delta: { text: "fallback" } })]),
      };
    }) as any;

    const agent = createPiEmbeddedAgent({
      model: "pi-default",
      modelFailover: ["pi-fallback"],
    });
    const events = [];

    for await (const event of agent.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: [],
    })) {
      events.push(event);
    }

    expect(callCount).toBe(2);
    const textDone = events.find((e) => e.type === "text_done");
    expect(textDone).toBeDefined();
    expect((textDone as any).text).toBe("fallback");
  });

  it("should yield error event when all models fail", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }) as any;

    const agent = createPiEmbeddedAgent({ model: "bad-model" });
    const events = [];

    for await (const event of agent.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: [],
    })) {
      events.push(event);
    }

    const errorEvt = events.find((e) => e.type === "error");
    expect(errorEvt).toBeDefined();
    expect((errorEvt as any).error.message).toContain("Pi API error");
  });

  it("should send authorization header when apiKey is set", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([JSON.stringify({ type: "text_delta", delta: { text: "ok" } })]),
    }) as any;

    const agent = createPiEmbeddedAgent({ apiKey: "my-secret-key" });

    for await (const _ of agent.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: [],
    })) { /* consume */ }

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers.Authorization).toBe("Bearer my-secret-key");
  });

  it("should call onEvent callback for each event", async () => {
    const sseEvents = [
      JSON.stringify({ type: "text_delta", delta: { text: "hi" } }),
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream(sseEvents),
    }) as any;

    const onEvent = vi.fn();
    const agent = createPiEmbeddedAgent({ apiKey: "test-key" });

    for await (const _ of agent.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: [],
      onEvent,
    })) { /* consume */ }

    // Should have been called for text_delta and text_done
    expect(onEvent).toHaveBeenCalled();
    const callTypes = onEvent.mock.calls.map((c: any) => c[0].type);
    expect(callTypes).toContain("text_delta");
    expect(callTypes).toContain("text_done");
  });
});
