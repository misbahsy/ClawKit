import type { Queue, QueuedMessage } from "clawkit:types";

export interface SteerQueueConfig {
  name?: string;
  concurrency?: number;
}

export default function createSteerQueue(config: SteerQueueConfig): Queue {
  const queue: QueuedMessage[] = [];
  let handler: ((msg: QueuedMessage) => Promise<void>) | null = null;
  let concurrency = config.concurrency ?? 1;
  let activeCount = 0;

  // Track which sessions are currently being processed
  const activeSessions = new Set<string>();
  // Steer buffers: messages that arrive while a session is processing
  const steerBuffers = new Map<string, QueuedMessage[]>();

  /**
   * Get the steer buffer for a session. These are messages that arrived
   * while the session handler was already running. The handler can call
   * this to inject new user messages into the current agent turn.
   */
  function getSteerBuffer(sessionId: string): QueuedMessage[] {
    return steerBuffers.get(sessionId) ?? [];
  }

  function clearSteerBuffer(sessionId: string): void {
    steerBuffers.delete(sessionId);
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
      // Attach steer buffer accessor to the message for the handler to use
      (msg as any).getSteerBuffer = () => getSteerBuffer(msg.sessionId);
      (msg as any).clearSteerBuffer = () => clearSteerBuffer(msg.sessionId);

      await handler(msg);
    } catch (err: any) {
      console.error(`Steer queue handler error (session ${msg.sessionId}): ${err.message}`);
    } finally {
      activeSessions.delete(msg.sessionId);
      clearSteerBuffer(msg.sessionId);
      activeCount--;
      if (queue.length > 0) {
        processNext();
      }
    }
  }

  return {
    name: "queue-steer",

    async enqueue(_sessionId: string, message: QueuedMessage) {
      const sessionId = message.sessionId;

      if (activeSessions.has(sessionId)) {
        // Session is currently processing - steer this message into the buffer
        let buffer = steerBuffers.get(sessionId);
        if (!buffer) {
          buffer = [];
          steerBuffers.set(sessionId, buffer);
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
        const steerCount = steerBuffers.get(sessionId)?.length ?? 0;
        return mainCount + steerCount;
      }
      let total = queue.length;
      for (const buf of steerBuffers.values()) {
        total += buf.length;
      }
      return total;
    },

    async drain() {
      while (queue.length > 0 || activeCount > 0) {
        await new Promise((r) => setTimeout(r, 50));
      }
    },

    // Expose steer buffer accessor as an extension
    getSteerBuffer,
  } as Queue & { getSteerBuffer: (sessionId: string) => QueuedMessage[] };
}
