import type { Scheduler, JobDefinition, JobInfo } from "clawkit:types";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";

export interface WebhookSchedulerConfig {
  port?: number;
  host?: string;
}

interface WebhookJob {
  id: string;
  definition: JobDefinition;
  path: string;
  method: string;
  runCount: number;
  lastRun?: Date;
}

export default function createWebhookScheduler(config: WebhookSchedulerConfig): Scheduler {
  const port = config.port ?? 3100;
  const host = config.host ?? "0.0.0.0";
  const jobs = new Map<string, WebhookJob>();
  let server: Server | null = null;
  let running = false;

  function generateId(): string {
    return `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function makeJobContext(job: WebhookJob): { jobId: string; runCount: number; lastRun?: Date; agent: any; sendMessage: () => Promise<void> } {
    return {
      jobId: job.id,
      runCount: job.runCount,
      lastRun: job.lastRun,
      agent: null as any,
      sendMessage: async () => {},
    };
  }

  function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? "";
    const method = (req.method ?? "POST").toUpperCase();

    // Parse /webhook/:jobId pattern
    const match = url.match(/^\/webhook\/([^/?]+)/);
    if (!match) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    const jobId = decodeURIComponent(match[1]);
    const job = jobs.get(jobId);

    if (!job) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Job "${jobId}" not found` }));
      return;
    }

    if (method !== job.method) {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Method ${method} not allowed, expected ${job.method}` }));
      return;
    }

    // Collect request body
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      job.runCount++;
      job.lastRun = new Date();

      try {
        const context = makeJobContext(job);
        // Attach webhook payload to context
        (context as any).payload = body ? tryParseJSON(body) : undefined;
        (context as any).headers = req.headers;

        await job.definition.handler(context);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, jobId: job.id, runCount: job.runCount }));
      } catch (err: any) {
        console.error(`Webhook job ${jobId} failed:`, err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  }

  function tryParseJSON(str: string): any {
    try { return JSON.parse(str); } catch { return str; }
  }

  return {
    name: "scheduler-webhook",

    async addJob(definition: JobDefinition): Promise<string> {
      const id = definition.id ?? generateId();

      if (jobs.has(id)) {
        throw new Error(`Job with id "${id}" already exists`);
      }

      const webhookConfig = definition.webhook;
      const path = webhookConfig?.path ?? `/webhook/${id}`;
      const method = (webhookConfig?.method ?? "POST").toUpperCase();

      const job: WebhookJob = {
        id,
        definition,
        path,
        method,
        runCount: 0,
      };

      jobs.set(id, job);
      return id;
    },

    async removeJob(id: string): Promise<void> {
      jobs.delete(id);
    },

    async listJobs(): Promise<JobInfo[]> {
      return Array.from(jobs.values()).map((job) => ({
        id: job.id,
        type: "webhook" as const,
        schedule: `${job.method} /webhook/${job.id}`,
        lastRun: job.lastRun,
        runCount: job.runCount,
        metadata: job.definition.metadata,
      }));
    },

    async start(): Promise<void> {
      if (running) return;
      running = true;

      return new Promise((resolve, reject) => {
        server = createServer(handleRequest);
        server.on("error", reject);
        server.listen(port, host, () => {
          resolve();
        });
      });
    },

    async stop(): Promise<void> {
      running = false;
      if (server) {
        return new Promise((resolve) => {
          server!.close(() => {
            server = null;
            resolve();
          });
        });
      }
    },
  };
}
