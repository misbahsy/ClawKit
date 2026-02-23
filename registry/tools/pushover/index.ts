import type { Tool, ToolContext, ToolResult } from "clawkit:types";

export interface PushoverToolConfig {
  userKey: string;
  apiToken: string;
  defaultDevice?: string;
}

export default function createPushoverTool(config: PushoverToolConfig): Tool {
  return {
    name: "pushover",
    description:
      "Send push notifications via the Pushover API. Supports priority levels, device targeting, and custom titles.",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Notification message body",
        },
        title: {
          type: "string",
          description: "Notification title (optional)",
        },
        priority: {
          type: "number",
          description: "Priority: -2 (lowest), -1 (low), 0 (normal), 1 (high), 2 (emergency)",
        },
        device: {
          type: "string",
          description: "Target device name (optional, sends to all devices if omitted)",
        },
      },
      required: ["message"],
    },

    async execute(
      args: { message: string; title?: string; priority?: number; device?: string },
      _context: ToolContext,
    ): Promise<ToolResult> {
      try {
        const body: Record<string, string | number> = {
          token: config.apiToken,
          user: config.userKey,
          message: args.message,
        };

        if (args.title) body.title = args.title;
        if (args.priority !== undefined) body.priority = args.priority;
        if (args.device ?? config.defaultDevice) {
          body.device = args.device ?? config.defaultDevice!;
        }

        // Emergency priority (2) requires retry and expire parameters
        if (args.priority === 2) {
          body.retry = 60;
          body.expire = 3600;
        }

        const response = await fetch("https://api.pushover.net/1/messages.json", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const data = await response.json();

        if (!response.ok || data.status !== 1) {
          const errors = data.errors?.join(", ") ?? `HTTP ${response.status}`;
          return { output: "", error: `Pushover error: ${errors}` };
        }

        return {
          output: `Notification sent: "${args.title ?? "(no title)"}" - ${args.message}`,
          metadata: { request: data.request, status: data.status },
        };
      } catch (err: any) {
        return { output: "", error: err.message };
      }
    },
  };
}
