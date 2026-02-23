import type { Tool, ToolContext, ToolResult } from "clawkit:types";

export interface ComposioToolConfig {
  apiKey?: string;
  apps?: string[];
  _composioModule?: any;
}

export default function createComposioTool(config: ComposioToolConfig): Tool {
  const apiKey = config.apiKey ?? process.env.COMPOSIO_API_KEY;
  const apps = config.apps ?? [];

  return {
    name: "composio",
    description: "Execute actions across 100+ apps via Composio. Supports GitHub, Slack, Gmail, Notion, and more.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", description: "Action to execute (e.g., 'github.create_issue', 'slack.send_message')" },
        params: { type: "object", description: "Parameters for the action" },
      },
      required: ["action"],
    },

    async execute(args: { action: string; params?: Record<string, any> }, _context: ToolContext): Promise<ToolResult> {
      if (!apiKey) {
        return { output: "", error: "COMPOSIO_API_KEY not set. Get one at https://composio.dev" };
      }

      try {
        const mod = config._composioModule ?? await import("composio-core");
        const ComposioClass = mod.Composio ?? mod.default?.Composio;
        if (!ComposioClass) {
          return { output: "", error: "composio-core module not found. Install with: npm install composio-core" };
        }
        const client = new ComposioClass({ apiKey });

        const result = await client.executeAction({
          action: args.action,
          params: args.params ?? {},
          connectedAccountId: apps[0],
        });

        return { output: typeof result === "string" ? result : JSON.stringify(result, null, 2) };
      } catch (err: any) {
        return { output: "", error: err.message };
      }
    },
  };
}
