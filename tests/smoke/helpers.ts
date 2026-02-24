import { it } from "vitest";
import type {
  Channel,
  AgentRuntime,
  Memory,
  Queue,
  PromptBuilder,
  IncomingMessage,
  AgentEvent,
} from "../../packages/core/src/types.js";

export function createMockAgent(response: string): AgentRuntime {
  return {
    name: "mock-agent",
    async *run(): AsyncGenerator<AgentEvent> {
      yield { type: "text_delta", text: response };
      yield { type: "text_done", text: response };
      yield { type: "done", usage: { inputTokens: 10, outputTokens: 5 } };
    },
    abort() {},
  };
}

export function createMockChannel(): Channel & {
  triggerMessage: (msg: IncomingMessage) => void;
  sentMessages: Array<{ to: string; text: string }>;
} {
  let callback: ((msg: IncomingMessage) => void) | null = null;
  const sentMessages: Array<{ to: string; text: string }> = [];

  return {
    name: "mock-channel",
    sentMessages,
    async connect() {},
    onMessage(cb) {
      callback = cb;
    },
    async sendMessage(to, content) {
      sentMessages.push({ to, text: content.text });
    },
    async sendMedia() {},
    async disconnect() {},
    triggerMessage(msg) {
      callback?.(msg);
    },
  };
}

export function createMockMemory(): Memory {
  const store = new Map<string, Array<{ role: string; content: string }>>();
  return {
    name: "mock-memory",
    async init() {},
    async saveMessages(sessionId, messages) {
      const existing = store.get(sessionId) ?? [];
      store.set(sessionId, [
        ...existing,
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ]);
    },
    async loadMessages(sessionId) {
      return (store.get(sessionId) ?? []).map((m) => ({
        role: m.role as any,
        content: m.content,
      }));
    },
    async clear(sessionId) {
      store.delete(sessionId);
    },
    async search() {
      return [];
    },
    async compact() {},
  };
}

export function createMockQueue(): Queue {
  let handler: ((msg: any) => Promise<void>) | null = null;
  return {
    name: "mock-queue",
    async enqueue(_sessionId, message) {
      if (handler) await handler(message);
    },
    process(fn) {
      handler = fn;
    },
    setConcurrency() {},
    async getQueueLength() {
      return 0;
    },
    async drain() {},
  };
}

export function createMockPrompt(): PromptBuilder {
  return {
    name: "mock-prompt",
    async build() {
      return "You are a test agent.";
    },
  };
}

/**
 * Returns the environment variable value or skips the test with a message.
 */
export function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    it.skip(`${key} not set`);
    return "";
  }
  return value;
}

/**
 * Wait for a condition with timeout.
 */
export function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a test incoming message.
 */
export function createTestMessage(
  text: string,
  sender = "test-user",
): IncomingMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    channel: "test",
    sender,
    content: text,
    timestamp: new Date(),
    raw: {},
  };
}
