import { describe, it, expect } from "vitest";
import createPriorityQueue from "../../registry/queue/priority/index.js";
import type { QueuedMessage } from "../../packages/core/src/types.js";

function makeMessage(
  sessionId: string,
  content: string,
  priority?: number,
  channel = "test",
  sender = "user1",
): QueuedMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    sessionId,
    message: {
      id: `msg-${Date.now()}`,
      channel,
      sender,
      content,
      timestamp: new Date(),
      raw: null,
    },
    priority,
    enqueuedAt: new Date(),
  };
}

describe("queue-priority", () => {
  it("should have the correct name", () => {
    const queue = createPriorityQueue({});
    expect(queue.name).toBe("queue-priority");
  });

  it("should process messages in priority order", async () => {
    const queue = createPriorityQueue({ concurrency: 1 });
    const processed: string[] = [];

    // Block processing until all messages are enqueued
    let resolveFirst: (() => void) | null = null;
    let firstCall = true;

    queue.process(async (msg) => {
      if (firstCall) {
        firstCall = false;
        await new Promise<void>((r) => { resolveFirst = r; });
      }
      processed.push(msg.message.content);
    });

    // Enqueue a blocking message first
    await queue.enqueue("s1", makeMessage("s1", "blocker", 0));
    await new Promise((r) => setTimeout(r, 20));

    // Now enqueue messages with different priorities while blocked
    await queue.enqueue("s1", makeMessage("s1", "low", 1));
    await queue.enqueue("s1", makeMessage("s1", "high", 10));
    await queue.enqueue("s1", makeMessage("s1", "medium", 5));

    // Unblock
    resolveFirst?.();
    await queue.drain();

    // After the blocker, remaining should be in priority order
    expect(processed[0]).toBe("blocker");
    expect(processed[1]).toBe("high");
    expect(processed[2]).toBe("medium");
    expect(processed[3]).toBe("low");
  });

  it("should apply priority boosts from priorityMap", async () => {
    const queue = createPriorityQueue({
      concurrency: 1,
      priorityMap: { vip: 100 },
    });
    const processed: string[] = [];

    let resolveFirst: (() => void) | null = null;
    let firstCall = true;

    queue.process(async (msg) => {
      if (firstCall) {
        firstCall = false;
        await new Promise<void>((r) => { resolveFirst = r; });
      }
      processed.push(msg.message.content);
    });

    await queue.enqueue("s1", makeMessage("s1", "blocker", 0));
    await new Promise((r) => setTimeout(r, 20));

    await queue.enqueue("s1", makeMessage("s1", "normal", 50, "regular", "user"));
    await queue.enqueue("s1", makeMessage("s1", "vip-channel", 0, "vip", "user"));

    resolveFirst?.();
    await queue.drain();

    expect(processed[0]).toBe("blocker");
    // vip-channel has boost of 100 from channel "vip", so it should come first
    expect(processed[1]).toBe("vip-channel");
    expect(processed[2]).toBe("normal");
  });

  it("should retry failed messages with backoff", async () => {
    const queue = createPriorityQueue({
      concurrency: 1,
      maxRetries: 3,
      maxBackoff: 200,
    });
    let attempts = 0;

    queue.process(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error("Simulated failure");
      }
    });

    await queue.enqueue("s1", makeMessage("s1", "retry-me"));
    await queue.drain();

    expect(attempts).toBe(3);
  });

  it("should send to dead letter queue after max retries", async () => {
    const queue = createPriorityQueue({
      concurrency: 1,
      maxRetries: 2,
      maxBackoff: 50,
    }) as ReturnType<typeof createPriorityQueue> & { getDeadLetters(): QueuedMessage[] };

    queue.process(async () => {
      throw new Error("Always fails");
    });

    await queue.enqueue("s1", makeMessage("s1", "doomed"));

    // Wait for retries + backoff
    await new Promise((r) => setTimeout(r, 500));
    await queue.drain();

    const deadLetters = queue.getDeadLetters();
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0].message.content).toBe("doomed");
  });

  it("should clear dead letters", async () => {
    const queue = createPriorityQueue({
      concurrency: 1,
      maxRetries: 1,
      maxBackoff: 10,
    }) as ReturnType<typeof createPriorityQueue> & {
      getDeadLetters(): QueuedMessage[];
      clearDeadLetters(): void;
    };

    queue.process(async () => {
      throw new Error("Fail");
    });

    await queue.enqueue("s1", makeMessage("s1", "fail-msg"));
    await new Promise((r) => setTimeout(r, 200));

    expect(queue.getDeadLetters().length).toBeGreaterThan(0);
    queue.clearDeadLetters();
    expect(queue.getDeadLetters()).toHaveLength(0);
  });

  it("should respect concurrency limit", async () => {
    const queue = createPriorityQueue({ concurrency: 2 });
    let maxConcurrent = 0;
    let current = 0;

    queue.process(async () => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise((r) => setTimeout(r, 50));
      current--;
    });

    for (let i = 0; i < 6; i++) {
      await queue.enqueue(`s${i}`, makeMessage(`s${i}`, `msg-${i}`));
    }

    await queue.drain();

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("should allow concurrency to be changed", async () => {
    const queue = createPriorityQueue({ concurrency: 1 });
    queue.setConcurrency(5);

    let maxConcurrent = 0;
    let current = 0;

    queue.process(async () => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise((r) => setTimeout(r, 30));
      current--;
    });

    for (let i = 0; i < 5; i++) {
      await queue.enqueue(`s${i}`, makeMessage(`s${i}`, `msg-${i}`));
    }

    await queue.drain();

    expect(maxConcurrent).toBeGreaterThan(1);
  });

  it("should report queue length", async () => {
    const queue = createPriorityQueue({ concurrency: 1 });
    let resolveHandler: (() => void) | null = null;

    queue.process(async () => {
      await new Promise<void>((r) => { resolveHandler = r; });
    });

    await queue.enqueue("s1", makeMessage("s1", "m1"));
    await queue.enqueue("s1", makeMessage("s1", "m2"));
    await queue.enqueue("s1", makeMessage("s1", "m3"));

    await new Promise((r) => setTimeout(r, 20));

    // One being processed, two in queue
    const len = await queue.getQueueLength();
    expect(len).toBeGreaterThanOrEqual(1);

    // Let them finish
    resolveHandler?.();
    await new Promise((r) => setTimeout(r, 20));
    resolveHandler?.();
    await new Promise((r) => setTimeout(r, 20));
    resolveHandler?.();
    await queue.drain();
  });

  it("should handle empty queue drain", async () => {
    const queue = createPriorityQueue({});
    queue.process(async () => {});
    await expect(queue.drain()).resolves.toBeUndefined();
  });
});
