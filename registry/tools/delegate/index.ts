import type { Tool, ToolContext, ToolResult } from "clawkit:types";

export interface DelegateToolConfig {
  defaultRuntime?: string;
  defaultModel?: string;
}

export default function createDelegateTool(config: DelegateToolConfig): Tool {
  return {
    name: "delegate",
    description: "Delegate a task to another agent runtime. Useful for routing tasks to specialized agents or different model providers.",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Task description to delegate",
        },
        runtime: {
          type: "string",
          description: "Target runtime identifier (e.g., 'openrouter', 'ollama', 'anthropic')",
        },
        model: {
          type: "string",
          description: "Model to use on the target runtime (optional)",
        },
      },
      required: ["task"],
    },

    async execute(
      args: { task: string; runtime?: string; model?: string },
      context: ToolContext,
    ): Promise<ToolResult> {
      const runtime = args.runtime ?? config.defaultRuntime;
      const model = args.model ?? config.defaultModel;

      try {
        // Route via sendMessage to the target runtime
        if (context.sendMessage) {
          const response = await context.sendMessage(runtime ?? "agent", {
            action: "delegate",
            task: args.task,
            model,
            fromSession: context.sessionId,
          });

          return {
            output: typeof response === "string" ? response : JSON.stringify(response, null, 2),
            metadata: { runtime, model, delegated: true },
          };
        }

        // Route via agent if available
        if (context.agent) {
          const result = await context.agent({
            task: args.task,
            model,
            runtime,
            parentSession: context.sessionId,
          });

          return {
            output: typeof result === "string" ? result : JSON.stringify(result, null, 2),
            metadata: { runtime, model, delegated: true },
          };
        }

        return {
          output: "",
          error: "No delegation runtime available. Neither context.sendMessage nor context.agent is configured.",
          metadata: {
            intent: "delegate",
            task: args.task,
            runtime,
            model,
          },
        };
      } catch (err: any) {
        return { output: "", error: err.message };
      }
    },
  };
}
