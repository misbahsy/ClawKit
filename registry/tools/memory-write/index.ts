import type { Tool, ToolContext, ToolResult } from "clawkit:types";

export interface MemoryWriteToolConfig {}

export default function createMemoryWriteTool(_config: MemoryWriteToolConfig): Tool {
  return {
    name: "memory_write",
    description: "Save content to long-term agent memory with optional tags for later retrieval.",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "Content to save to memory",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for categorizing the memory entry",
        },
        sessionId: {
          type: "string",
          description: "Associate with a specific session (optional, defaults to current)",
        },
      },
      required: ["content"],
    },

    async execute(
      args: { content: string; tags?: string[]; sessionId?: string },
      context: ToolContext,
    ): Promise<ToolResult> {
      const sessionId = args.sessionId ?? context.sessionId;
      const tags = args.tags ?? [];

      try {
        // Delegate to runtime via sendMessage if available
        if (context.sendMessage) {
          const response = await context.sendMessage("memory", {
            action: "write",
            content: args.content,
            tags,
            sessionId,
          });
          return { output: typeof response === "string" ? response : JSON.stringify(response, null, 2) };
        }

        // Fallback: return intent for runtime to fulfill
        return {
          output: JSON.stringify({
            intent: "memory_write",
            content: args.content,
            tags,
            sessionId,
          }),
          metadata: {
            delegated: false,
            reason: "No memory runtime connected. Write intent returned for external handling.",
          },
        };
      } catch (err: any) {
        return { output: "", error: err.message };
      }
    },
  };
}
