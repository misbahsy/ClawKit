import type { Tool, ToolContext, ToolResult } from "clawkit:types";

export interface CronToolConfig {}

// In-memory job store (per-process). Runtime can persist externally via sendMessage.
const jobs = new Map<string, { schedule: string; handler: string; createdAt: string; sessionId: string }>();
let jobCounter = 0;

export default function createCronTool(_config: CronToolConfig): Tool {
  return {
    name: "cron",
    description: "Create, list, or delete scheduled jobs. Jobs are registered for the runtime scheduler to execute.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "list", "delete"],
          description: "Action to perform",
        },
        schedule: {
          type: "string",
          description: "Cron expression (e.g., '*/5 * * * *' for every 5 minutes). Required for create.",
        },
        handler: {
          type: "string",
          description: "Task description or handler identifier to run on schedule. Required for create.",
        },
        jobId: {
          type: "string",
          description: "Job ID to delete. Required for delete.",
        },
      },
      required: ["action"],
    },

    async execute(
      args: { action: string; schedule?: string; handler?: string; jobId?: string },
      context: ToolContext,
    ): Promise<ToolResult> {
      try {
        switch (args.action) {
          case "create": {
            if (!args.schedule) {
              return { output: "", error: "schedule is required for create action" };
            }
            if (!args.handler) {
              return { output: "", error: "handler is required for create action" };
            }

            const id = `job_${++jobCounter}`;
            const job = {
              schedule: args.schedule,
              handler: args.handler,
              createdAt: new Date().toISOString(),
              sessionId: context.sessionId,
            };
            jobs.set(id, job);

            // Notify runtime if available
            if (context.sendMessage) {
              await context.sendMessage("scheduler", {
                action: "register",
                jobId: id,
                ...job,
              });
            }

            return {
              output: `Created job ${id}: "${args.handler}" on schedule "${args.schedule}"`,
              metadata: { jobId: id },
            };
          }

          case "list": {
            const entries = Array.from(jobs.entries()).map(([id, job]) => ({
              id,
              ...job,
            }));

            if (entries.length === 0) {
              return { output: "No scheduled jobs." };
            }

            const formatted = entries
              .map((j) => `${j.id}: "${j.handler}" [${j.schedule}] (created: ${j.createdAt})`)
              .join("\n");
            return { output: formatted, metadata: { count: entries.length } };
          }

          case "delete": {
            if (!args.jobId) {
              return { output: "", error: "jobId is required for delete action" };
            }
            if (!jobs.has(args.jobId)) {
              return { output: "", error: `Job ${args.jobId} not found` };
            }

            jobs.delete(args.jobId);

            // Notify runtime if available
            if (context.sendMessage) {
              await context.sendMessage("scheduler", {
                action: "unregister",
                jobId: args.jobId,
              });
            }

            return { output: `Deleted job ${args.jobId}` };
          }

          default:
            return { output: "", error: `Unknown action: ${args.action}. Use create, list, or delete.` };
        }
      } catch (err: any) {
        return { output: "", error: err.message };
      }
    },
  };
}
