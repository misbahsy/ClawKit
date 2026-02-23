import type { Scheduler, JobDefinition, JobInfo } from "clawkit:types";

export interface EventSchedulerConfig {
  maxListeners?: number;
}

interface EventJob {
  id: string;
  definition: JobDefinition;
  eventName: string;
  runCount: number;
  lastRun?: Date;
}

export default function createEventScheduler(config: EventSchedulerConfig): Scheduler {
  const maxListeners = config.maxListeners ?? 100;
  const jobs = new Map<string, EventJob>();
  // Map from event name to set of job ids
  const eventToJobs = new Map<string, Set<string>>();
  let running = false;

  function generateId(): string {
    return `ev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function makeJobContext(job: EventJob): { jobId: string; runCount: number; lastRun?: Date; agent: any; sendMessage: () => Promise<void> } {
    return {
      jobId: job.id,
      runCount: job.runCount,
      lastRun: job.lastRun,
      agent: null as any,
      sendMessage: async () => {},
    };
  }

  function getListenerCount(): number {
    let count = 0;
    for (const jobSet of eventToJobs.values()) {
      count += jobSet.size;
    }
    return count;
  }

  /**
   * Emit a named event, triggering all handlers registered for that event.
   * Returns the number of handlers that were triggered.
   */
  async function emit(eventName: string, data?: any): Promise<number> {
    if (!running) return 0;

    const jobIds = eventToJobs.get(eventName);
    if (!jobIds || jobIds.size === 0) return 0;

    let triggered = 0;

    for (const jobId of jobIds) {
      const job = jobs.get(jobId);
      if (!job) continue;

      job.runCount++;
      job.lastRun = new Date();
      triggered++;

      try {
        const context = makeJobContext(job);
        (context as any).eventName = eventName;
        (context as any).eventData = data;
        await job.definition.handler(context);
      } catch (err) {
        console.error(`Event job ${jobId} failed for event "${eventName}":`, err);
      }
    }

    return triggered;
  }

  const scheduler: Scheduler & { emit: (eventName: string, data?: any) => Promise<number> } = {
    name: "scheduler-event",

    async addJob(definition: JobDefinition): Promise<string> {
      const id = definition.id ?? generateId();

      if (jobs.has(id)) {
        throw new Error(`Job with id "${id}" already exists`);
      }

      const eventName = definition.event;
      if (!eventName) {
        throw new Error("Event jobs require an event name (set definition.event)");
      }

      if (getListenerCount() >= maxListeners) {
        throw new Error(`Maximum listener count (${maxListeners}) reached`);
      }

      const job: EventJob = {
        id,
        definition,
        eventName,
        runCount: 0,
      };

      jobs.set(id, job);

      let jobSet = eventToJobs.get(eventName);
      if (!jobSet) {
        jobSet = new Set();
        eventToJobs.set(eventName, jobSet);
      }
      jobSet.add(id);

      return id;
    },

    async removeJob(id: string): Promise<void> {
      const job = jobs.get(id);
      if (!job) return;

      const jobSet = eventToJobs.get(job.eventName);
      if (jobSet) {
        jobSet.delete(id);
        if (jobSet.size === 0) {
          eventToJobs.delete(job.eventName);
        }
      }

      jobs.delete(id);
    },

    async listJobs(): Promise<JobInfo[]> {
      return Array.from(jobs.values()).map((job) => ({
        id: job.id,
        type: "event" as const,
        schedule: `on:${job.eventName}`,
        lastRun: job.lastRun,
        runCount: job.runCount,
        metadata: job.definition.metadata,
      }));
    },

    async start(): Promise<void> {
      running = true;
    },

    async stop(): Promise<void> {
      running = false;
    },

    emit,
  };

  return scheduler;
}
