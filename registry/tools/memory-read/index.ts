import type { Tool, ToolContext, ToolResult } from "clawkit:types";

export interface MemoryReadToolConfig {
  defaultLimit?: number;
}

export default function createMemoryReadTool(config: MemoryReadToolConfig): Tool {
  const defaultLimit = config.defaultLimit ?? 10;

  return {
    name: "memory_read",
    description: "Search agent memory for relevant past context. Queries long-term memory by semantic similarity.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query to find relevant memories",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (default: 10)",
        },
        sessionId: {
          type: "string",
          description: "Filter by session ID (optional, defaults to current session)",
        },
      },
      required: ["query"],
    },

    async execute(
      args: { query: string; limit?: number; sessionId?: string },
      context: ToolContext,
    ): Promise<ToolResult> {
      const limit = args.limit ?? defaultLimit;
      const sessionId = args.sessionId ?? context.sessionId;

      try {
        // Delegate to runtime via sendMessage if available
        if (context.sendMessage) {
          const response = await context.sendMessage("memory", {
            action: "search",
            query: args.query,
            limit,
            sessionId,
          });
          return { output: typeof response === "string" ? response : JSON.stringify(response, null, 2) };
        }

        // Fallback: return intent for runtime to fulfill
        return {
          output: JSON.stringify({
            intent: "memory_search",
            query: args.query,
            limit,
            sessionId,
          }),
          metadata: {
            delegated: false,
            reason: "No memory runtime connected. Search intent returned for external handling.",
          },
        };
      } catch (err: any) {
        return { output: "", error: err.message };
      }
    },
  };
}
