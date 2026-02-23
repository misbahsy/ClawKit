import { describe, it, expect, vi } from "vitest";
import createSteerQueue from "../../registry/queue/steer/index.js";
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

describe("queue-steer", () => {
  it("should have correct name", () => {
    const queue = createSteerQueue({});
    expect(queue.name).toBe("queue-steer");
  });

  it("should process messages normally when session is idle", async () => {
    const queue = createSteerQueue({});
    const processed: string[] = [];

    queue.process(async (msg) => {
      processed.push(msg.message.content);
    });

    await queue.enqueue("s1", makeMessage("s1", "hello"));
    await queue.drain();

    expect(processed).toEqual(["hello"]);
  });

  it("should steer messages into buffer when session is active", async () => {
    const queue = createSteerQueue({ concurrency: 1 }) as any;
    const steeredMessages: string[] = [];
    let resolveHandler: (() => void) | null = null;

    queue.process(async (msg: any) => {
      // Simulate long-running handler that checks steer buffer
      await new Promise<void>((r) => { resolveHandler = r; });

      // Check steer buffer
      const buffer = msg.getSteerBuffer?.() ?? queue.getSteerBuffer(msg.sessionId);
      for (const steered of buffer) {
        steeredMessages.push(steered.message.content);
      }
    });

    // First message starts processing
    await queue.enqueue("s1", makeMessage("s1", "first"));
    await new Promise((r) => setTimeout(r, 20));

    // Second message should be steered into buffer
    await queue.enqueue("s1", makeMessage("s1", "steered-1"));
    await queue.enqueue("s1", makeMessage("s1", "steered-2"));

    // Check queue length includes steered messages
    const len = await queue.getQueueLength("s1");
    expect(len).toBeGreaterThanOrEqual(2);

    // Complete the handler
    resolveHandler?.();
    await queue.drain();

    expect(steeredMessages).toContain("steered-1");
    expect(steeredMessages).toContain("steered-2");
  });

  it("should not steer messages for different sessions", async () => {
    const queue = createSteerQueue({ concurrency: 2 });
    const processed: string[] = [];
    let resolveS1: (() => void) | null = null;

    queue.process(async (msg) => {
      if (msg.sessionId === "s1") {
        await new Promise<void>((r) => { resolveS1 = r; });
      }
      processed.push(`${msg.sessionId}:${msg.message.content}`);
    });

    // s1 starts processing and blocks
    await queue.enqueue("s1", makeMessage("s1", "first"));
    await new Promise((r) => setTimeout(r, 20));

    // s2 message should process independently
    await queue.enqueue("s2", makeMessage("s2", "independent"));
    await new Promise((r) => setTimeout(r, 50));

    expect(processed).toContain("s2:independent");

    resolveS1?.();
    await queue.drain();
  });

  it("should respect concurrency limit", async () => {
    const queue = createSteerQueue({ concurrency: 1 });
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

  it("should allow concurrency to be changed", () => {
    const queue = createSteerQueue({ concurrency: 1 });
    expect(() => queue.setConcurrency(5)).not.toThrow();
  });

  it("should clear steer buffer after handler completes", async () => {
    const queue = createSteerQueue({}) as any;
    let resolveHandler: (() => void) | null = null;

    queue.process(async () => {
      await new Promise<void>((r) => { resolveHandler = r; });
    });

    await queue.enqueue("s1", makeMessage("s1", "first"));
    await new Promise((r) => setTimeout(r, 20));
    await queue.enqueue("s1", makeMessage("s1", "steered"));

    resolveHandler?.();
    await queue.drain();

    // After drain, steer buffer should be empty
    const buffer = queue.getSteerBuffer("s1");
    expect(buffer).toEqual([]);
  });

  it("should handle errors in handler without losing messages", async () => {
    const queue = createSteerQueue({});
    const processed: string[] = [];
    let failFirst = true;

    queue.process(async (msg) => {
      if (failFirst && msg.message.content === "first") {
        failFirst = false;
        throw new Error("Simulated failure");
      }
      processed.push(msg.message.content);
    });

    await queue.enqueue("s1", makeMessage("s1", "first"));
    await queue.enqueue("s1", makeMessage("s1", "second"));
    await queue.drain();

    // Second message should still be processed despite first failing
    expect(processed).toContain("second");
  });

  it("should report total queue length", async () => {
    const queue = createSteerQueue({});
    const length = await queue.getQueueLength();
    expect(length).toBe(0);
  });
});
