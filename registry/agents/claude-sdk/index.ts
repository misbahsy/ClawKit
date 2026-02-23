import type { AgentRuntime, AgentEvent, ToolResult } from "clawkit:types";
import { query } from "@anthropic-ai/claude-code";

export interface ClaudeSdkAgentConfig {
  name?: string;
  model?: string;
  apiKey?: string;
  maxTurns?: number;
}

export default function createClaudeSdkAgent(config: ClaudeSdkAgentConfig): AgentRuntime {
  const model = config.model ?? "claude-sonnet-4-20250514";
  const maxTurns = config.maxTurns ?? 10;

  if (config.apiKey) {
    process.env.ANTHROPIC_API_KEY = config.apiKey;
  }

  return {
    name: "agent-claude-sdk",

    async *run(params): AsyncGenerator<AgentEvent> {
      const { systemPrompt, messages, toolExecutor } = params;

      const prompt = messages.findLast((m) => m.role === "user")?.content ?? "";

      try {
        const result = await query({
          prompt,
          systemPrompt,
          options: { model, maxTurns },
        });

        let responseText = "";
        if (Array.isArray(result)) {
          for (const item of result) {
            if (typeof item === "string") {
              responseText += item;
            } else if (item && typeof item === "object" && "type" in item) {
              if (item.type === "text" && "text" in item) {
                responseText += (item as any).text;
              } else if (item.type === "tool_use") {
                const tu = item as any;
                yield { type: "tool_use", id: tu.id, name: tu.name, input: tu.input };
                if (toolExecutor) {
                  const toolResult: ToolResult = await toolExecutor(tu.name, tu.input);
                  yield { type: "tool_result", id: tu.id, output: toolResult.error ?? toolResult.output };
                }
              }
            }
          }
        } else if (typeof result === "string") {
          responseText = result;
        } else if (result && typeof result === "object" && "content" in result) {
          responseText = String((result as any).content);
        }

        if (responseText) {
          yield { type: "text_delta", text: responseText };
          yield { type: "text_done", text: responseText };
        }
        yield { type: "done" };
      } catch (err: any) {
        yield { type: "error", error: err };
        yield { type: "done" };
      }
    },

    abort() {},
  };
}
