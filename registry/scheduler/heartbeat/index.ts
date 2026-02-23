import type { Scheduler, JobDefinition, JobInfo, JobContext } from "clawkit:types";
import cron from "node-cron";

export interface HeartbeatSchedulerConfig {
  timezone?: string;
}

interface HeartbeatJob {
  id: string;
  definition: JobDefinition;
  task: cron.ScheduledTask | null;
  intervalTimer: ReturnType<typeof setInterval> | null;
  type: "cron" | "interval";
  runCount: number;
  lastRun?: Date;
}

export default function createHeartbeatScheduler(config: HeartbeatSchedulerConfig): Scheduler {
  const timezone = config.timezone ?? "UTC";
  const jobs = new Map<string, HeartbeatJob>();
  let running = false;

  function generateId(): string {
    return `hb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function makeContext(job: HeartbeatJob): JobContext {
    return {
      jobId: job.id,
      runCount: job.runCount,
      lastRun: job.lastRun,
      agent: null as any,
      sendMessage: async () => {},
    };
  }

  function startJob(job: HeartbeatJob): void {
    if (job.definition.cron && !job.task) {
      job.task = cron.schedule(
        job.definition.cron,
        async () => {
          job.runCount++;
          job.lastRun = new Date();
          try { await job.definition.handler(makeContext(job)); } catch (err) { console.error(`Heartbeat ${job.id} failed:`, err); }
        },
        { scheduled: true, timezone },
      );
    }
    if (job.definition.interval && !job.intervalTimer) {
      job.intervalTimer = setInterval(async () => {
        job.runCount++;
        job.lastRun = new Date();
        try { await job.definition.handler(makeContext(job)); } catch (err) { console.error(`Heartbeat ${job.id} failed:`, err); }
      }, job.definition.interval);
    }
  }

  return {
    name: "scheduler-heartbeat",

    async addJob(definition: JobDefinition): Promise<string> {
      const id = definition.id ?? generateId();
      if (jobs.has(id)) throw new Error(`Job "${id}" already exists`);
      if (!definition.cron && !definition.interval) throw new Error("Heartbeat jobs require cron or interval");

      const job: HeartbeatJob = {
        id, definition,
        task: null, intervalTimer: null,
        type: definition.cron ? "cron" : "interval",
        runCount: 0,
      };
      jobs.set(id, job);
      if (running) startJob(job);
      return id;
    },

    async removeJob(id: string): Promise<void> {
      const job = jobs.get(id);
      if (!job) return;
      if (job.task) job.task.stop();
      if (job.intervalTimer) clearInterval(job.intervalTimer);
      jobs.delete(id);
    },

    async listJobs(): Promise<JobInfo[]> {
      return Array.from(jobs.values()).map(j => ({
        id: j.id, type: j.type,
        schedule: j.definition.cron ?? `every ${j.definition.interval}ms`,
        lastRun: j.lastRun, runCount: j.runCount,
      }));
    },

    async start(): Promise<void> {
      running = true;
      for (const job of jobs.values()) startJob(job);
    },

    async stop(): Promise<void> {
      running = false;
      for (const job of jobs.values()) {
        if (job.task) job.task.stop();
        if (job.intervalTimer) clearInterval(job.intervalTimer);
      }
    },
  };
}
