import type { Queue, QueuedMessage } from "clawkit:types";

export interface PriorityQueueConfig {
  name?: string;
  concurrency?: number;
  maxRetries?: number;
  maxBackoff?: number;
  priorityMap?: Record<string, number>;
}

interface InternalEntry {
  message: QueuedMessage;
  attempts: number;
  nextAttemptAt: number;
}

export default function createPriorityQueue(config: PriorityQueueConfig): Queue {
  const queue: InternalEntry[] = [];
  const deadLetters: QueuedMessage[] = [];
  let handler: ((msg: QueuedMessage) => Promise<void>) | null = null;
  let concurrency = config.concurrency ?? 1;
  let activeCount = 0;
  let processing = false;
  const maxRetries = config.maxRetries ?? 3;
  const maxBackoff = config.maxBackoff ?? 30000;
  const priorityMap = config.priorityMap ?? {};

  function effectivePriority(entry: InternalEntry): number {
    const msg = entry.message;
    const basePriority = msg.priority ?? 0;
    const channelBoost = priorityMap[msg.message.channel] ?? 0;
    const senderBoost = priorityMap[msg.message.sender] ?? 0;
    return basePriority + channelBoost + senderBoost;
  }

  function sortQueue(): void {
    queue.sort((a, b) => effectivePriority(b) - effectivePriority(a));
  }

  function backoffDelay(attempt: number): number {
    const delay = Math.min(Math.pow(2, attempt) * 100, maxBackoff);
    return delay;
  }

  async function processNext(): Promise<void> {
    if (!handler || activeCount >= concurrency || queue.length === 0) return;

    const now = Date.now();
    const readyIndex = queue.findIndex((e) => e.nextAttemptAt <= now);
    if (readyIndex === -1) {
      // Schedule a retry check for the earliest pending entry
      if (queue.length > 0) {
        const earliest = Math.min(...queue.map((e) => e.nextAttemptAt));
        const delay = Math.max(earliest - now, 10);
        setTimeout(() => {
          if (processing) scheduleProcess();
        }, delay);
      }
      return;
    }

    const entry = queue.splice(readyIndex, 1)[0];
    activeCount++;

    try {
      await handler(entry.message);
    } catch (err: any) {
      entry.attempts++;
      if (entry.attempts >= maxRetries) {
        deadLetters.push(entry.message);
      } else {
        entry.nextAttemptAt = Date.now() + backoffDelay(entry.attempts);
        queue.push(entry);
        sortQueue();
      }
    } finally {
      activeCount--;
      scheduleProcess();
    }
  }

  function scheduleProcess(): void {
    if (!processing) return;
    // Launch up to concurrency parallel workers
    while (activeCount < concurrency && queue.length > 0) {
      const now = Date.now();
      const hasReady = queue.some((e) => e.nextAttemptAt <= now);
      if (!hasReady) {
        // Schedule delayed retry
        const earliest = Math.min(...queue.map((e) => e.nextAttemptAt));
        const delay = Math.max(earliest - now, 10);
        setTimeout(() => {
          if (processing) scheduleProcess();
        }, delay);
        break;
      }
      processNext();
    }
  }

  return {
    name: "queue-priority",

    async enqueue(_sessionId: string, message: QueuedMessage) {
      const entry: InternalEntry = {
        message,
        attempts: 0,
        nextAttemptAt: 0,
      };
      queue.push(entry);
      sortQueue();
      processing = true;
      scheduleProcess();
    },

    process(fn) {
      handler = fn;
    },

    setConcurrency(limit: number) {
      concurrency = limit;
    },

    async getQueueLength(_sessionId?: string) {
      return queue.length;
    },

    async drain() {
      processing = true;
      while (queue.length > 0 || activeCount > 0) {
        await new Promise((r) => setTimeout(r, 50));
      }
    },

    getDeadLetters(): QueuedMessage[] {
      return [...deadLetters];
    },

    clearDeadLetters() {
      deadLetters.length = 0;
    },
  } as Queue & { getDeadLetters(): QueuedMessage[]; clearDeadLetters(): void };
}
