import type { Queue, QueuedMessage } from "clawkit:types";

export interface PerGroupQueueConfig {
  name?: string;
  concurrency?: number;
  maxRetries?: number;
  maxBackoff?: number;
}

export default function createPerGroupQueue(config: PerGroupQueueConfig): Queue {
  const maxConcurrency = config.concurrency ?? 3;
  const maxRetries = config.maxRetries ?? 3;
  const maxBackoff = config.maxBackoff ?? 30000;

  const queues = new Map<string, QueuedMessage[]>();
  let handler: ((msg: QueuedMessage) => Promise<void>) | null = null;
  let concurrency = maxConcurrency;
  let activeCount = 0;

  function getQueue(sessionId: string): QueuedMessage[] {
    let q = queues.get(sessionId);
    if (!q) {
      q = [];
      queues.set(sessionId, q);
    }
    return q;
  }

  function getBackoffDelay(attempt: number): number {
    return Math.min(1000 * Math.pow(2, attempt), maxBackoff);
  }

  async function processNext(): Promise<void> {
    if (!handler || activeCount >= concurrency) return;

    // Round-robin across session queues
    for (const [sessionId, q] of queues) {
      if (q.length === 0) continue;
      if (activeCount >= concurrency) break;

      activeCount++;
      const msg = q.shift()!;
      if (q.length === 0) queues.delete(sessionId);

      processMessage(msg).finally(() => {
        activeCount--;
        if (totalLength() > 0) {
          processNext();
        }
      });
    }
  }

  async function processMessage(msg: QueuedMessage): Promise<void> {
    const attempts = msg.attempts ?? 0;
    const max = msg.maxAttempts ?? maxRetries;

    try {
      await handler!(msg);
    } catch (err: any) {
      console.error(`Queue handler error (session ${msg.sessionId}, attempt ${attempts + 1}): ${err.message}`);
      if (attempts + 1 < max) {
        const delay = getBackoffDelay(attempts);
        await new Promise((r) => setTimeout(r, delay));
        const q = getQueue(msg.sessionId);
        q.unshift({ ...msg, attempts: attempts + 1 });
        // processNext will be called from the finally block
      }
    }
  }

  function totalLength(): number {
    let total = 0;
    for (const q of queues.values()) {
      total += q.length;
    }
    return total;
  }

  return {
    name: "queue-per-group",

    async enqueue(sessionId: string, message: QueuedMessage) {
      const q = getQueue(sessionId);
      q.push(message);
      processNext();
    },

    process(fn) {
      handler = fn;
    },

    setConcurrency(limit: number) {
      concurrency = limit;
    },

    async getQueueLength(sessionId?: string) {
      if (sessionId) {
        return queues.get(sessionId)?.length ?? 0;
      }
      return totalLength();
    },

    async drain() {
      while (totalLength() > 0 || activeCount > 0) {
        await new Promise((r) => setTimeout(r, 50));
      }
    },
  };
}
