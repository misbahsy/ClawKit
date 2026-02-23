import type { Tool, ToolContext, ToolResult } from "clawkit:types";

export interface SpawnAgentToolConfig {
  defaultModel?: string;
  defaultMaxTurns?: number;
}

export default function createSpawnAgentTool(config: SpawnAgentToolConfig): Tool {
  return {
    name: "spawn_agent",
    description: "Spawn a sub-agent to handle a task in parallel. The sub-agent runs independently and returns results.",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Task description for the sub-agent",
        },
        model: {
          type: "string",
          description: "Model to use for the sub-agent (optional)",
        },
        maxTurns: {
          type: "number",
          description: "Maximum conversation turns for the sub-agent (default: 5)",
        },
      },
      required: ["task"],
    },

    async execute(
      args: { task: string; model?: string; maxTurns?: number },
      context: ToolContext,
    ): Promise<ToolResult> {
      const model = args.model ?? config.defaultModel;
      const maxTurns = args.maxTurns ?? config.defaultMaxTurns ?? 5;

      try {
        if (context.agent) {
          const result = await context.agent({
            task: args.task,
            model,
            maxTurns,
            parentSession: context.sessionId,
          });

          return {
            output: typeof result === "string" ? result : JSON.stringify(result, null, 2),
            metadata: { model, maxTurns, parentSession: context.sessionId },
          };
        }

        return {
          output: "",
          error: "No agent runtime available. context.agent is not configured.",
          metadata: {
            intent: "spawn_agent",
            task: args.task,
            model,
            maxTurns,
          },
        };
      } catch (err: any) {
        return { output: "", error: err.message };
      }
    },
  };
}
