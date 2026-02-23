import type { Scheduler, JobDefinition, JobInfo, JobContext } from "clawkit:types";
import Database from "better-sqlite3";
import cron from "node-cron";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface PersistentSchedulerConfig {
  dbPath?: string;
  timezone?: string;
}

export default function createPersistentScheduler(config: PersistentSchedulerConfig): Scheduler {
  const dbPath = config.dbPath ?? "./data/scheduler.db";
  const timezone = config.timezone ?? "UTC";
  let db: Database.Database;
  const activeTasks = new Map<string, cron.ScheduledTask | ReturnType<typeof setInterval>>();
  const handlerMap = new Map<string, (ctx: JobContext) => Promise<void>>();
  let running = false;

  function initDb(): void {
    mkdirSync(dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        schedule TEXT,
        handler_name TEXT NOT NULL,
        metadata TEXT,
        next_run TEXT,
        last_run TEXT,
        run_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active'
      )
    `);
  }

  function generateId(): string {
    return `pj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function makeContext(id: string, runCount: number, lastRun?: string): JobContext {
    return {
      jobId: id,
      runCount,
      lastRun: lastRun ? new Date(lastRun) : undefined,
      agent: null as any,
      sendMessage: async () => {},
    };
  }

  function startPersistedJob(row: { id: string; type: string; schedule: string | null; handler_name: string; run_count: number; last_run: string | null }): void {
    const handler = handlerMap.get(row.handler_name);
    if (!handler) return;

    if (row.type === "cron" && row.schedule) {
      const task = cron.schedule(
        row.schedule,
        async () => {
          const now = new Date();
          db.prepare("UPDATE jobs SET run_count = run_count + 1, last_run = ? WHERE id = ?").run(now.toISOString(), row.id);
          const updated = db.prepare("SELECT run_count, last_run FROM jobs WHERE id = ?").get(row.id) as any;
          try { await handler(makeContext(row.id, updated.run_count, updated.last_run)); } catch (err) { console.error(`Job ${row.id} failed:`, err); }
        },
        { scheduled: true, timezone },
      );
      activeTasks.set(row.id, task);
    } else if (row.type === "interval" && row.schedule) {
      const ms = parseInt(row.schedule, 10);
      const timer = setInterval(async () => {
        const now = new Date();
        db.prepare("UPDATE jobs SET run_count = run_count + 1, last_run = ? WHERE id = ?").run(now.toISOString(), row.id);
        const updated = db.prepare("SELECT run_count, last_run FROM jobs WHERE id = ?").get(row.id) as any;
        try { await handler(makeContext(row.id, updated.run_count, updated.last_run)); } catch (err) { console.error(`Job ${row.id} failed:`, err); }
      }, ms);
      activeTasks.set(row.id, timer);
    }
  }

  return {
    name: "scheduler-persistent",

    async addJob(definition: JobDefinition): Promise<string> {
      if (!db) initDb();
      const id = definition.id ?? generateId();

      const type = definition.cron ? "cron" : definition.interval ? "interval" : "once";
      const schedule = definition.cron ?? (definition.interval ? String(definition.interval) : null);
      const handlerName = id; // Use job id as handler name

      // Register the handler
      handlerMap.set(handlerName, definition.handler);

      db.prepare(
        "INSERT OR REPLACE INTO jobs (id, type, schedule, handler_name, metadata, status) VALUES (?, ?, ?, ?, ?, 'active')"
      ).run(id, type, schedule, handlerName, definition.metadata ? JSON.stringify(definition.metadata) : null);

      if (running) {
        const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as any;
        if (row) startPersistedJob(row);
      }

      return id;
    },

    async removeJob(id: string): Promise<void> {
      if (!db) initDb();
      const task = activeTasks.get(id);
      if (task) {
        if (typeof (task as any).stop === "function") (task as any).stop();
        else clearInterval(task as ReturnType<typeof setInterval>);
        activeTasks.delete(id);
      }
      handlerMap.delete(id);
      db.prepare("DELETE FROM jobs WHERE id = ?").run(id);
    },

    async listJobs(): Promise<JobInfo[]> {
      if (!db) initDb();
      const rows = db.prepare("SELECT * FROM jobs WHERE status = 'active'").all() as any[];
      return rows.map(r => ({
        id: r.id,
        type: r.type as JobInfo["type"],
        schedule: r.schedule ?? undefined,
        lastRun: r.last_run ? new Date(r.last_run) : undefined,
        runCount: r.run_count,
        metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      }));
    },

    async start(): Promise<void> {
      if (!db) initDb();
      running = true;
      const rows = db.prepare("SELECT * FROM jobs WHERE status = 'active'").all() as any[];
      for (const row of rows) startPersistedJob(row);
    },

    async stop(): Promise<void> {
      running = false;
      for (const [id, task] of activeTasks) {
        if (typeof (task as any).stop === "function") (task as any).stop();
        else clearInterval(task as ReturnType<typeof setInterval>);
      }
      activeTasks.clear();
    },
  };
}
