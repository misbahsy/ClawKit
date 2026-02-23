import type { Scheduler, JobDefinition, JobInfo } from "clawkit:types";

export interface SimpleSchedulerConfig {
  name?: string;
}

interface StoredJob {
  id: string;
  definition: JobDefinition;
  intervalTimer: ReturnType<typeof setInterval> | null;
  onceTimer: ReturnType<typeof setTimeout> | null;
  type: "interval" | "once";
  runCount: number;
  lastRun?: Date;
  nextRun?: Date;
}

export default function createSimpleScheduler(_config: SimpleSchedulerConfig): Scheduler {
  const jobs = new Map<string, StoredJob>();
  let running = false;

  function generateId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function makeJobContext(stored: StoredJob): {
    jobId: string;
    runCount: number;
    lastRun?: Date;
    agent: any;
    sendMessage: () => Promise<void>;
  } {
    return {
      jobId: stored.id,
      runCount: stored.runCount,
      lastRun: stored.lastRun,
      agent: null as any,
      sendMessage: async () => {},
    };
  }

  function startJob(stored: StoredJob): void {
    const { definition, id } = stored;

    if (definition.interval && !stored.intervalTimer) {
      stored.intervalTimer = setInterval(async () => {
        stored.runCount++;
        stored.lastRun = new Date();
        try {
          await definition.handler(makeJobContext(stored));
        } catch (err) {
          console.error(`Job ${id} failed:`, err);
        }
      }, definition.interval);
    }

    if (definition.once && !stored.onceTimer) {
      const delay = definition.once.getTime() - Date.now();
      if (delay > 0) {
        stored.nextRun = definition.once;
        stored.onceTimer = setTimeout(async () => {
          stored.runCount++;
          stored.lastRun = new Date();
          stored.nextRun = undefined;
          try {
            await definition.handler(makeJobContext(stored));
          } catch (err) {
            console.error(`Job ${id} failed:`, err);
          }
        }, delay);
      }
    }
  }

  return {
    name: "scheduler-simple",

    async addJob(job: JobDefinition): Promise<string> {
      if (job.cron) {
        throw new Error(
          "scheduler-simple does not support cron expressions. Use scheduler-cron instead.",
        );
      }

      const id = job.id ?? generateId();

      if (jobs.has(id)) {
        throw new Error(`Job with id "${id}" already exists`);
      }

      if (!job.interval && !job.once) {
        throw new Error("Job must have either interval or once defined");
      }

      const stored: StoredJob = {
        id,
        definition: job,
        intervalTimer: null,
        onceTimer: null,
        type: job.interval ? "interval" : "once",
        runCount: 0,
        lastRun: undefined,
        nextRun: undefined,
      };

      jobs.set(id, stored);

      if (running) {
        startJob(stored);
      }

      return id;
    },

    async removeJob(id: string): Promise<void> {
      const stored = jobs.get(id);
      if (!stored) return;

      if (stored.intervalTimer) clearInterval(stored.intervalTimer);
      if (stored.onceTimer) clearTimeout(stored.onceTimer);

      jobs.delete(id);
    },

    async listJobs(): Promise<JobInfo[]> {
      return Array.from(jobs.values()).map((stored) => ({
        id: stored.id,
        type: stored.type,
        schedule: stored.definition.interval
          ? `every ${stored.definition.interval}ms`
          : undefined,
        nextRun: stored.nextRun,
        lastRun: stored.lastRun,
        runCount: stored.runCount,
        metadata: stored.definition.metadata,
      }));
    },

    async start(): Promise<void> {
      running = true;
      for (const stored of jobs.values()) {
        startJob(stored);
      }
    },

    async stop(): Promise<void> {
      running = false;
      for (const stored of jobs.values()) {
        if (stored.intervalTimer) clearInterval(stored.intervalTimer);
        if (stored.onceTimer) clearTimeout(stored.onceTimer);
        stored.intervalTimer = null;
        stored.onceTimer = null;
      }
    },
  };
}
