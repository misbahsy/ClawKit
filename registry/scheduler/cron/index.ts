import type { Scheduler, JobDefinition, JobInfo } from "clawkit:types";
import cron from "node-cron";

export interface CronSchedulerConfig {
  name?: string;
  timezone?: string;
}

interface StoredJob {
  id: string;
  definition: JobDefinition;
  task: cron.ScheduledTask | null;
  intervalTimer: ReturnType<typeof setInterval> | null;
  onceTimer: ReturnType<typeof setTimeout> | null;
  type: "cron" | "interval" | "once";
  runCount: number;
  lastRun?: Date;
  nextRun?: Date;
}

export default function createCronScheduler(config: CronSchedulerConfig): Scheduler {
  const jobs = new Map<string, StoredJob>();
  const timezone = config.timezone ?? "UTC";
  let running = false;

  function generateId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function makeJobContext(stored: StoredJob): { jobId: string; runCount: number; lastRun?: Date; agent: any; sendMessage: () => Promise<void> } {
    return { jobId: stored.id, runCount: stored.runCount, lastRun: stored.lastRun, agent: null as any, sendMessage: async () => {} };
  }

  return {
    name: "scheduler-cron",

    async addJob(job: JobDefinition): Promise<string> {
      const id = job.id ?? generateId();

      if (jobs.has(id)) {
        throw new Error(`Job with id "${id}" already exists`);
      }

      const stored: StoredJob = {
        id,
        definition: job,
        task: null,
        intervalTimer: null,
        onceTimer: null,
        type: job.cron ? "cron" : job.interval ? "interval" : "once",
        runCount: 0,
        lastRun: undefined,
        nextRun: undefined,
      };

      if (job.cron) {
        if (!cron.validate(job.cron)) {
          throw new Error(`Invalid cron expression: "${job.cron}"`);
        }

        stored.task = cron.schedule(
          job.cron,
          async () => {
            stored.runCount++;
            stored.lastRun = new Date();
            try {
              await job.handler(makeJobContext(stored));
            } catch (err) {
              console.error(`Job ${id} failed:`, err);
            }
          },
          { scheduled: false, timezone },
        );
      }

      jobs.set(id, stored);

      if (running) {
        startJob(stored);
      }

      return id;
    },

    async removeJob(id: string): Promise<void> {
      const stored = jobs.get(id);
      if (!stored) return;

      if (stored.task) stored.task.stop();
      if (stored.intervalTimer) clearInterval(stored.intervalTimer);
      if (stored.onceTimer) clearTimeout(stored.onceTimer);

      jobs.delete(id);
    },

    async listJobs(): Promise<JobInfo[]> {
      return Array.from(jobs.values()).map((stored) => ({
        id: stored.id,
        type: stored.type,
        schedule: stored.definition.cron ?? (stored.definition.interval ? `every ${stored.definition.interval}ms` : undefined),
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
        if (stored.task) stored.task.stop();
        if (stored.intervalTimer) clearInterval(stored.intervalTimer);
        if (stored.onceTimer) clearTimeout(stored.onceTimer);
      }
    },
  };

  function startJob(stored: StoredJob): void {
    const { definition, id } = stored;

    if (stored.task) {
      stored.task.start();
    }

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
        stored.onceTimer = setTimeout(async () => {
          stored.runCount++;
          stored.lastRun = new Date();
          try {
            await definition.handler(makeJobContext(stored));
          } catch (err) {
            console.error(`Job ${id} failed:`, err);
          }
        }, delay);
      }
    }
  }
}
