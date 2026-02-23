import { describe, it, expect, vi } from "vitest";
import { startAgent, type ClawKitComponents } from "../../packages/core/src/runtime.js";
import type {
  Channel, AgentRuntime, Memory, Queue, PromptBuilder, Tool,
  IncomingMessage, AgentEvent, ClawKitConfig,
} from "../../packages/core/src/types.js";

function createMockChannel(): Channel & { triggerMessage: (msg: IncomingMessage) => void; sentMessages: Array<{ to: string; text: string }> } {
  let callback: ((msg: IncomingMessage) => void) | null = null;
  const sentMessages: Array<{ to: string; text: string }> = [];

  return {
    name: "test",
    sentMessages,
    async connect() {},
    onMessage(cb) { callback = cb; },
    async sendMessage(to, content) { sentMessages.push({ to, text: content.text }); },
    async sendMedia() {},
    async disconnect() {},
    triggerMessage(msg) { callback?.(msg); },
  };
}

function createMockAgent(response: string): AgentRuntime {
  return {
    name: "test-agent",
    async *run(params): AsyncGenerator<AgentEvent> {
      yield { type: "text_delta", text: response };
      yield { type: "text_done", text: response };
      yield { type: "done", usage: { inputTokens: 10, outputTokens: 5 } };
    },
    abort() {},
  };
}

function createMockMemory(): Memory {
  const store = new Map<string, Array<{ role: string; content: string }>>();
  return {
    name: "test-memory",
    async init() {},
    async saveMessages(sessionId, messages) {
      const existing = store.get(sessionId) ?? [];
      store.set(sessionId, [...existing, ...messages.map(m => ({ role: m.role, content: m.content }))]);
    },
    async loadMessages(sessionId) {
      return (store.get(sessionId) ?? []).map(m => ({ role: m.role as any, content: m.content }));
    },
    async clear(sessionId) { store.delete(sessionId); },
    async search() { return []; },
    async compact() {},
  };
}

function createMockQueue(): Queue {
  let handler: ((msg: any) => Promise<void>) | null = null;
  return {
    name: "test-queue",
    async enqueue(_sessionId, message) {
      if (handler) await handler(message);
    },
    process(fn) { handler = fn; },
    setConcurrency() {},
    async getQueueLength() { return 0; },
    async drain() {},
  };
}

function createMockPrompt(): PromptBuilder {
  return {
    name: "test-prompt",
    async build() { return "You are a test agent."; },
  };
}

describe("startAgent", () => {
  it("should wire channel message through queue to agent and send response", async () => {
    const channel = createMockChannel();
    const agent = createMockAgent("Hello back!");
    const memory = createMockMemory();
    const queue = createMockQueue();
    const prompt = createMockPrompt();

    const config: ClawKitConfig = {
      name: "test",
      typescript: true,
      aliases: { components: "./components", workspace: "./workspace" },
    };

    const components: ClawKitComponents = {
      channels: [channel],
      agent,
      memory,
      queue,
      promptBuilder: prompt,
      tools: [],
      config,
    };

    await startAgent(components);

    // Simulate incoming message
    channel.triggerMessage({
      id: "msg-1",
      channel: "test",
      sender: "user-1",
      content: "Hello",
      timestamp: new Date(),
      raw: {},
    });

    // Wait for async processing
    await new Promise((r) => setTimeout(r, 100));

    expect(channel.sentMessages).toHaveLength(1);
    expect(channel.sentMessages[0].text).toBe("Hello back!");
  });

  it("should save messages to memory after response", async () => {
    const channel = createMockChannel();
    const agent = createMockAgent("Test response");
    const memory = createMockMemory();
    const queue = createMockQueue();
    const prompt = createMockPrompt();

    const config: ClawKitConfig = {
      name: "test",
      typescript: true,
      aliases: { components: "./components", workspace: "./workspace" },
    };

    await startAgent({
      channels: [channel],
      agent,
      memory,
      queue,
      promptBuilder: prompt,
      tools: [],
      config,
    });

    channel.triggerMessage({
      id: "msg-2",
      channel: "test",
      sender: "user-2",
      content: "Hi",
      timestamp: new Date(),
      raw: {},
    });

    await new Promise((r) => setTimeout(r, 100));

    const messages = await memory.loadMessages("user-2");
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("Hi");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toBe("Test response");
  });

  it("should provide toolExecutor that maps to registered tools", async () => {
    const channel = createMockChannel();
    const toolExecutions: string[] = [];

    const agent: AgentRuntime = {
      name: "tool-test-agent",
      async *run(params): AsyncGenerator<AgentEvent> {
        // Simulate calling a tool
        if (params.toolExecutor) {
          const result = await params.toolExecutor("test-tool", { input: "value" });
          toolExecutions.push(result.output);
        }
        yield { type: "text_done", text: "Done" };
        yield { type: "done" };
      },
      abort() {},
    };

    const tool: Tool = {
      name: "test-tool",
      description: "A test tool",
      parameters: {},
      async execute(args) {
        return { output: `executed with ${JSON.stringify(args)}` };
      },
    };

    const config: ClawKitConfig = {
      name: "test",
      typescript: true,
      aliases: { components: "./components", workspace: "./workspace" },
    };

    await startAgent({
      channels: [channel],
      agent,
      memory: createMockMemory(),
      queue: createMockQueue(),
      promptBuilder: createMockPrompt(),
      tools: [tool],
      config,
    });

    channel.triggerMessage({
      id: "msg-3",
      channel: "test",
      sender: "user-3",
      content: "Use tool",
      timestamp: new Date(),
      raw: {},
    });

    await new Promise((r) => setTimeout(r, 100));
    expect(toolExecutions).toHaveLength(1);
    expect(toolExecutions[0]).toContain("executed with");
  });
});
