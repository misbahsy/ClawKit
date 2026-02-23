import type { Queue, QueuedMessage } from "clawkit:types";

export interface CollectQueueConfig {
  name?: string;
  concurrency?: number;
  batchSeparator?: string;
}

export default function createCollectQueue(config: CollectQueueConfig): Queue {
  const queue: QueuedMessage[] = [];
  let handler: ((msg: QueuedMessage) => Promise<void>) | null = null;
  let concurrency = config.concurrency ?? 1;
  let activeCount = 0;
  const batchSeparator = config.batchSeparator ?? "\n---\n";

  // Track which sessions are currently being processed
  const activeSessions = new Set<string>();
  // Collected messages: held until current turn for that session ends
  const collectBuffers = new Map<string, QueuedMessage[]>();

  function combineMessages(messages: QueuedMessage[]): QueuedMessage {
    // Merge collected messages into a single batched message
    const first = messages[0];
    const combinedContent = messages
      .map((m) => m.message.content)
      .join(batchSeparator);

    return {
      id: `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sessionId: first.sessionId,
      message: {
        ...first.message,
        id: `batch_${Date.now()}`,
        content: combinedContent,
      },
      enqueuedAt: new Date(),
    };
  }

  async function processNext(): Promise<void> {
    if (!handler || activeCount >= concurrency || queue.length === 0) return;

    // Find next message whose session is not already active
    const idx = queue.findIndex((m) => !activeSessions.has(m.sessionId));
    if (idx === -1) return;

    activeCount++;
    const msg = queue.splice(idx, 1)[0];
    activeSessions.add(msg.sessionId);

    try {
      await handler(msg);
    } catch (err: any) {
      console.error(`Collect queue handler error (session ${msg.sessionId}): ${err.message}`);
    } finally {
      const sessionId = msg.sessionId;
      activeSessions.delete(sessionId);

      // Check if messages were collected during processing
      const collected = collectBuffers.get(sessionId);
      if (collected && collected.length > 0) {
        collectBuffers.delete(sessionId);
        // Batch collected messages into a single combined message
        const batched = combineMessages(collected);
        queue.push(batched);
      }

      activeCount--;
      if (queue.length > 0) {
        processNext();
      }
    }
  }

  return {
    name: "queue-collect",

    async enqueue(_sessionId: string, message: QueuedMessage) {
      const sessionId = message.sessionId;

      if (activeSessions.has(sessionId)) {
        // Session is currently processing - collect this message
        let buffer = collectBuffers.get(sessionId);
        if (!buffer) {
          buffer = [];
          collectBuffers.set(sessionId, buffer);
        }
        buffer.push(message);
      } else {
        // Session is idle - add to main queue
        queue.push(message);
        processNext();
      }
    },

    process(fn) {
      handler = fn;
    },

    setConcurrency(limit: number) {
      concurrency = limit;
    },

    async getQueueLength(sessionId?: string) {
      if (sessionId) {
        const mainCount = queue.filter((m) => m.sessionId === sessionId).length;
        const collectCount = collectBuffers.get(sessionId)?.length ?? 0;
        return mainCount + collectCount;
      }
      let total = queue.length;
      for (const buf of collectBuffers.values()) {
        total += buf.length;
      }
      return total;
    },

    async drain() {
      while (queue.length > 0 || activeCount > 0) {
        await new Promise((r) => setTimeout(r, 50));
      }
    },
  };
}
