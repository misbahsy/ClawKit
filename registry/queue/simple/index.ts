import type { Queue, QueuedMessage } from "clawkit:types";

export interface SimpleQueueConfig {
  name?: string;
  concurrency?: number;
}

export default function createSimpleQueue(config: SimpleQueueConfig): Queue {
  const queue: QueuedMessage[] = [];
  let handler: ((msg: QueuedMessage) => Promise<void>) | null = null;
  let concurrency = config.concurrency ?? 1;
  let activeCount = 0;

  async function processNext(): Promise<void> {
    if (!handler || activeCount >= concurrency || queue.length === 0) return;

    activeCount++;
    const msg = queue.shift()!;

    try {
      await handler(msg);
    } catch (err: any) {
      console.error(`Queue handler error: ${err.message}`);
    } finally {
      activeCount--;
      if (queue.length > 0) {
        processNext();
      }
    }
  }

  return {
    name: "queue-simple",

    async enqueue(_sessionId: string, message: QueuedMessage) {
      queue.push(message);
      processNext();
    },

    process(fn) {
      handler = fn;
    },

    setConcurrency(limit: number) {
      concurrency = limit;
    },

    async getQueueLength() {
      return queue.length;
    },

    async drain() {
      while (queue.length > 0 || activeCount > 0) {
        await new Promise((r) => setTimeout(r, 50));
      }
    },
  };
}
