import { describe, it, expect } from "vitest";
import createPerGroupQueue from "../../registry/queue/per-group/index.js";
import type { QueuedMessage } from "../../packages/core/src/types.js";

function makeMessage(sessionId: string, content: string): QueuedMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    sessionId,
    message: {
      id: `msg-${Date.now()}`,
      channel: "test",
      sender: "user1",
      content,
      timestamp: new Date(),
      raw: null,
    },
    enqueuedAt: new Date(),
  };
}

describe("queue-per-group", () => {
  it("should process messages from separate sessions", async () => {
    const queue = createPerGroupQueue({ concurrency: 3 });
    const processed: string[] = [];

    queue.process(async (msg) => {
      processed.push(`${msg.sessionId}:${msg.message.content}`);
    });

    await queue.enqueue("group-a", makeMessage("group-a", "Hello A"));
    await queue.enqueue("group-b", makeMessage("group-b", "Hello B"));

    await queue.drain();

    expect(processed).toContain("group-a:Hello A");
    expect(processed).toContain("group-b:Hello B");
  });

  it("should respect global concurrency limit", async () => {
    const queue = createPerGroupQueue({ concurrency: 1 });
    let maxConcurrent = 0;
    let current = 0;

    queue.process(async () => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise((r) => setTimeout(r, 20));
      current--;
    });

    await queue.enqueue("g1", makeMessage("g1", "m1"));
    await queue.enqueue("g2", makeMessage("g2", "m2"));
    await queue.enqueue("g3", makeMessage("g3", "m3"));

    await queue.drain();

    expect(maxConcurrent).toBe(1);
  });

  it("should handle per-session ordering", async () => {
    const queue = createPerGroupQueue({ concurrency: 1 });
    const order: string[] = [];

    queue.process(async (msg) => {
      order.push(msg.message.content);
      await new Promise((r) => setTimeout(r, 5));
    });

    await queue.enqueue("session-1", makeMessage("session-1", "first"));
    await queue.enqueue("session-1", makeMessage("session-1", "second"));
    await queue.enqueue("session-1", makeMessage("session-1", "third"));

    await queue.drain();

    expect(order).toEqual(["first", "second", "third"]);
  });

  it("should retry with backoff on failures", async () => {
    const queue = createPerGroupQueue({ concurrency: 3, maxRetries: 2, maxBackoff: 100 });
    let attempts = 0;

    queue.process(async () => {
      attempts++;
      if (attempts < 2) {
        throw new Error("Simulated failure");
      }
    });

    await queue.enqueue("s1", makeMessage("s1", "retry-me"));
    await queue.drain();

    expect(attempts).toBe(2);
  });

  it("should report queue length per session", async () => {
    const queue = createPerGroupQueue({ concurrency: 1 });
    let resolveHandler: (() => void) | null = null;

    queue.process(async () => {
      await new Promise<void>((r) => { resolveHandler = r; });
    });

    await queue.enqueue("s1", makeMessage("s1", "m1"));
    await queue.enqueue("s1", makeMessage("s1", "m2"));
    await queue.enqueue("s2", makeMessage("s2", "m3"));

    // Wait a tick for processing to start
    await new Promise((r) => setTimeout(r, 10));

    // One message is being processed, so session queues have remaining items
    const totalLen = await queue.getQueueLength();
    expect(totalLen).toBeGreaterThanOrEqual(1);

    // Let it finish
    resolveHandler?.();
    await new Promise((r) => setTimeout(r, 50));
    resolveHandler?.();
    await new Promise((r) => setTimeout(r, 50));
    resolveHandler?.();
    await queue.drain();
  });

  it("should allow concurrency to be changed", async () => {
    const queue = createPerGroupQueue({ concurrency: 1 });
    queue.setConcurrency(5);

    let maxConcurrent = 0;
    let current = 0;

    queue.process(async () => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise((r) => setTimeout(r, 20));
      current--;
    });

    for (let i = 0; i < 5; i++) {
      await queue.enqueue(`g${i}`, makeMessage(`g${i}`, `m${i}`));
    }

    await queue.drain();

    expect(maxConcurrent).toBeGreaterThan(1);
  });
});
