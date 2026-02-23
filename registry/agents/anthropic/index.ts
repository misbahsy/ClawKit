import type { AgentRuntime, AgentEvent, Message, ToolDefinition, ToolResult } from "clawkit:types";
import Anthropic from "@anthropic-ai/sdk";

export interface AnthropicAgentConfig {
  name?: string;
  model?: string;
  maxTokens?: number;
  apiKey?: string;
}

export default function createAnthropicAgent(config: AnthropicAgentConfig): AgentRuntime {
  const model = config.model ?? "claude-sonnet-4-20250514";
  const maxTokens = config.maxTokens ?? 16384;
  const client = new Anthropic({ apiKey: config.apiKey || undefined });
  let abortController: AbortController | null = null;

  function toAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
    return messages.map((m) => ({
      role: m.role === "system" ? "user" as const : m.role as "user" | "assistant",
      content: m.content,
    }));
  }

  function toAnthropicTools(tools: ToolDefinition[]): Anthropic.Tool[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool["input_schema"],
    }));
  }

  return {
    name: "agent-anthropic",

    async *run(params): AsyncGenerator<AgentEvent> {
      const { systemPrompt, messages, tools, toolExecutor } = params;
      abortController = new AbortController();

      const anthropicMessages = toAnthropicMessages(messages);
      const anthropicTools = toAnthropicTools(tools);
      let currentMessages = [...anthropicMessages];
      let continueLoop = true;

      while (continueLoop) {
        const stream = client.messages.stream({
          model,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: currentMessages,
          tools: anthropicTools.length > 0 ? anthropicTools : undefined,
        }, { signal: abortController.signal });

        let responseText = "";

        for await (const event of stream) {
          if (event.type === "content_block_delta") {
            if (event.delta.type === "text_delta") {
              responseText += event.delta.text;
              yield { type: "text_delta", text: event.delta.text };
            }
          }
        }

        const finalMessage = await stream.finalMessage();

        if (finalMessage.stop_reason === "tool_use") {
          const toolUseBlocks = finalMessage.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
          );

          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const block of toolUseBlocks) {
            yield { type: "tool_use", id: block.id, name: block.name, input: block.input };

            if (toolExecutor) {
              const result: ToolResult = await toolExecutor(block.name, block.input);
              yield { type: "tool_result", id: block.id, output: result.error ?? result.output };

              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: result.error ?? result.output,
              });
            }
          }

          currentMessages.push({ role: "assistant", content: finalMessage.content });
          currentMessages.push({ role: "user", content: toolResults });
        } else {
          if (responseText) {
            yield { type: "text_done", text: responseText };
          }
          yield {
            type: "done",
            usage: {
              inputTokens: finalMessage.usage.input_tokens,
              outputTokens: finalMessage.usage.output_tokens,
              cacheReadTokens: (finalMessage.usage as any).cache_read_input_tokens,
              cacheWriteTokens: (finalMessage.usage as any).cache_creation_input_tokens,
            },
          };
          continueLoop = false;
        }
      }
    },

    abort() {
      abortController?.abort();
    },
  };
}
