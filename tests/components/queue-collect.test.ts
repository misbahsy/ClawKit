import { describe, it, expect, vi } from "vitest";
import createCollectQueue from "../../registry/queue/collect/index.js";
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

describe("queue-collect", () => {
  it("should have correct name", () => {
    const queue = createCollectQueue({});
    expect(queue.name).toBe("queue-collect");
  });

  it("should process messages normally when session is idle", async () => {
    const queue = createCollectQueue({});
    const processed: string[] = [];

    queue.process(async (msg) => {
      processed.push(msg.message.content);
    });

    await queue.enqueue("s1", makeMessage("s1", "hello"));
    await queue.drain();

    expect(processed).toEqual(["hello"]);
  });

  it("should batch collected messages after current turn ends", async () => {
    const queue = createCollectQueue({ batchSeparator: "\n---\n" });
    const processed: string[] = [];
    let resolveHandler: (() => void) | null = null;
    let handlerCallCount = 0;

    queue.process(async (msg) => {
      handlerCallCount++;
      if (handlerCallCount === 1) {
        // First call - pause to let messages collect
        await new Promise<void>((r) => { resolveHandler = r; });
      }
      processed.push(msg.message.content);
    });

    // First message starts processing
    await queue.enqueue("s1", makeMessage("s1", "first"));
    await new Promise((r) => setTimeout(r, 20));

    // These messages should be collected while first is processing
    await queue.enqueue("s1", makeMessage("s1", "second"));
    await queue.enqueue("s1", makeMessage("s1", "third"));

    // Complete the first handler
    resolveHandler?.();
    await queue.drain();

    // The collected messages should be batched into one
    expect(processed).toHaveLength(2);
    expect(processed[0]).toBe("first");
    expect(processed[1]).toContain("second");
    expect(processed[1]).toContain("third");
    expect(processed[1]).toContain("---");
  });

  it("should use custom batch separator", async () => {
    const queue = createCollectQueue({ batchSeparator: " | " });
    const processed: string[] = [];
    let resolveHandler: (() => void) | null = null;
    let handlerCallCount = 0;

    queue.process(async (msg) => {
      handlerCallCount++;
      if (handlerCallCount === 1) {
        await new Promise<void>((r) => { resolveHandler = r; });
      }
      processed.push(msg.message.content);
    });

    await queue.enqueue("s1", makeMessage("s1", "first"));
    await new Promise((r) => setTimeout(r, 20));

    await queue.enqueue("s1", makeMessage("s1", "A"));
    await queue.enqueue("s1", makeMessage("s1", "B"));

    resolveHandler?.();
    await queue.drain();

    expect(processed[1]).toBe("A | B");
  });

  it("should not batch messages for different sessions", async () => {
    const queue = createCollectQueue({ concurrency: 2 });
    const processed: string[] = [];
    let resolveS1: (() => void) | null = null;

    queue.process(async (msg) => {
      if (msg.sessionId === "s1" && msg.message.content === "first") {
        await new Promise<void>((r) => { resolveS1 = r; });
      }
      processed.push(`${msg.sessionId}:${msg.message.content}`);
    });

    // s1 starts processing and blocks
    await queue.enqueue("s1", makeMessage("s1", "first"));
    await new Promise((r) => setTimeout(r, 20));

    // s2 processes independently
    await queue.enqueue("s2", makeMessage("s2", "independent"));
    await new Promise((r) => setTimeout(r, 50));

    expect(processed).toContain("s2:independent");

    resolveS1?.();
    await queue.drain();
  });

  it("should respect concurrency limit", async () => {
    const queue = createCollectQueue({ concurrency: 1 });
    let maxConcurrent = 0;
    let current = 0;

    queue.process(async () => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise((r) => setTimeout(r, 20));
      current--;
    });

    await queue.enqueue("s1", makeMessage("s1", "m1"));
    await queue.enqueue("s2", makeMessage("s2", "m2"));
    await queue.drain();

    expect(maxConcurrent).toBe(1);
  });

  it("should report queue length including collected messages", async () => {
    const queue = createCollectQueue({});
    let resolveHandler: (() => void) | null = null;
    let handlerCallCount = 0;

    queue.process(async () => {
      handlerCallCount++;
      if (handlerCallCount === 1) {
        await new Promise<void>((r) => { resolveHandler = r; });
      }
      // Second call (batched messages) completes immediately
    });

    await queue.enqueue("s1", makeMessage("s1", "first"));
    await new Promise((r) => setTimeout(r, 20));

    await queue.enqueue("s1", makeMessage("s1", "collected-1"));
    await queue.enqueue("s1", makeMessage("s1", "collected-2"));

    const len = await queue.getQueueLength("s1");
    expect(len).toBeGreaterThanOrEqual(2);

    resolveHandler?.();
    await queue.drain();
  });

  it("should allow concurrency to be changed", () => {
    const queue = createCollectQueue({ concurrency: 1 });
    expect(() => queue.setConcurrency(5)).not.toThrow();
  });

  it("should handle errors in handler without losing collected messages", async () => {
    const queue = createCollectQueue({});
    const processed: string[] = [];
    let handlerCallCount = 0;

    queue.process(async (msg) => {
      handlerCallCount++;
      if (handlerCallCount === 1) {
        // Simulate some time passing to allow message collection
        await new Promise((r) => setTimeout(r, 30));
        throw new Error("Simulated failure");
      }
      processed.push(msg.message.content);
    });

    await queue.enqueue("s1", makeMessage("s1", "first"));
    await new Promise((r) => setTimeout(r, 10));
    await queue.enqueue("s1", makeMessage("s1", "second"));

    await queue.drain();

    // The collected message should still be processed
    expect(processed.length).toBeGreaterThanOrEqual(1);
  });

  it("should report total queue length when no session specified", async () => {
    const queue = createCollectQueue({});
    const length = await queue.getQueueLength();
    expect(length).toBe(0);
  });

  it("should use default batch separator", async () => {
    const queue = createCollectQueue({});
    const processed: string[] = [];
    let resolveHandler: (() => void) | null = null;
    let handlerCallCount = 0;

    queue.process(async (msg) => {
      handlerCallCount++;
      if (handlerCallCount === 1) {
        await new Promise<void>((r) => { resolveHandler = r; });
      }
      processed.push(msg.message.content);
    });

    await queue.enqueue("s1", makeMessage("s1", "first"));
    await new Promise((r) => setTimeout(r, 20));

    await queue.enqueue("s1", makeMessage("s1", "X"));
    await queue.enqueue("s1", makeMessage("s1", "Y"));

    resolveHandler?.();
    await queue.drain();

    // Default separator is "\n---\n"
    expect(processed[1]).toBe("X\n---\nY");
  });
});
