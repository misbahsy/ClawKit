import type { Queue, QueuedMessage } from "clawkit:types";
import Database from "better-sqlite3";

export interface PersistentQueueConfig {
  name?: string;
  dbPath?: string;
  maxRetries?: number;
  concurrency?: number;
}

type MessageStatus = "pending" | "processing" | "done" | "failed";

interface QueueRow {
  id: string;
  session_id: string;
  message: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  status: MessageStatus;
  created_at: string;
}

export default function createPersistentQueue(config: PersistentQueueConfig): Queue {
  const dbPath = config.dbPath ?? ".clawkit/queue.db";
  const maxRetries = config.maxRetries ?? 3;
  let concurrency = config.concurrency ?? 1;
  let handler: ((msg: QueuedMessage) => Promise<void>) | null = null;
  let activeCount = 0;
  let polling = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent read/write performance
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS queue (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      message TEXT NOT NULL,
      priority INTEGER DEFAULT 0,
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_queue_status ON queue(status);
    CREATE INDEX IF NOT EXISTS idx_queue_session ON queue(session_id);
    CREATE INDEX IF NOT EXISTS idx_queue_priority ON queue(priority DESC, created_at ASC);
  `);

  const insertStmt = db.prepare(`
    INSERT INTO queue (id, session_id, message, priority, attempts, max_attempts, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
  `);

  const fetchPendingStmt = db.prepare(`
    SELECT * FROM queue
    WHERE status = 'pending'
    ORDER BY priority DESC, created_at ASC
    LIMIT ?
  `);

  const updateStatusStmt = db.prepare(`
    UPDATE queue SET status = ?, attempts = ? WHERE id = ?
  `);

  const countStmt = db.prepare(`
    SELECT COUNT(*) as count FROM queue WHERE status IN ('pending', 'processing')
  `);

  const countBySessionStmt = db.prepare(`
    SELECT COUNT(*) as count FROM queue WHERE session_id = ? AND status IN ('pending', 'processing')
  `);

  const cleanupStmt = db.prepare(`
    DELETE FROM queue WHERE status = 'done'
  `);

  function deserializeMessage(row: QueueRow): QueuedMessage {
    const parsed = JSON.parse(row.message);
    return {
      id: row.id,
      sessionId: row.session_id,
      message: {
        ...parsed,
        timestamp: new Date(parsed.timestamp),
      },
      priority: row.priority,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      enqueuedAt: new Date(row.created_at),
    };
  }

  async function processNext(): Promise<void> {
    if (!handler || activeCount >= concurrency) return;

    const rows = fetchPendingStmt.all(concurrency - activeCount) as QueueRow[];
    if (rows.length === 0) return;

    for (const row of rows) {
      if (activeCount >= concurrency) break;

      activeCount++;
      updateStatusStmt.run("processing", row.attempts, row.id);

      const msg = deserializeMessage(row);

      processMessage(row.id, msg, row.attempts, row.max_attempts).finally(() => {
        activeCount--;
        processNext();
      });
    }
  }

  async function processMessage(
    id: string,
    msg: QueuedMessage,
    attempts: number,
    maxAttempts: number,
  ): Promise<void> {
    try {
      await handler!(msg);
      updateStatusStmt.run("done", attempts + 1, id);
    } catch (err: any) {
      console.error(`Persistent queue handler error (id ${id}, attempt ${attempts + 1}): ${err.message}`);
      if (attempts + 1 < maxAttempts) {
        // Retry: reset to pending with incremented attempts
        updateStatusStmt.run("pending", attempts + 1, id);
      } else {
        updateStatusStmt.run("failed", attempts + 1, id);
      }
    }
  }

  function startPolling(): void {
    if (polling) return;
    polling = true;
    pollTimer = setInterval(() => {
      if (handler && activeCount < concurrency) {
        processNext();
      }
    }, 200);
  }

  return {
    name: "queue-persistent",

    async enqueue(_sessionId: string, message: QueuedMessage) {
      const serialized = JSON.stringify(message.message);
      insertStmt.run(
        message.id,
        message.sessionId,
        serialized,
        message.priority ?? 0,
        message.attempts ?? 0,
        message.maxAttempts ?? maxRetries,
      );
      processNext();
    },

    process(fn) {
      handler = fn;
      startPolling();
      processNext();
    },

    setConcurrency(limit: number) {
      concurrency = limit;
    },

    async getQueueLength(sessionId?: string) {
      if (sessionId) {
        const row = countBySessionStmt.get(sessionId) as { count: number };
        return row.count;
      }
      const row = countStmt.get() as { count: number };
      return row.count;
    },

    async drain() {
      while (true) {
        const row = countStmt.get() as { count: number };
        if (row.count === 0 && activeCount === 0) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
        polling = false;
      }
      cleanupStmt.run();
    },
  };
}
