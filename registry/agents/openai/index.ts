import type { AgentRuntime, AgentEvent, Message, ToolDefinition, ToolResult } from "clawkit:types";
import OpenAI from "openai";

export interface OpenAIAgentConfig {
  name?: string;
  model?: string;
  maxTokens?: number;
  apiKey?: string;
}

interface OpenAITool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, any> };
}

export default function createOpenAIAgent(config: OpenAIAgentConfig): AgentRuntime {
  const model = config.model ?? "gpt-4o";
  const maxTokens = config.maxTokens ?? 4096;
  const client = new OpenAI({ apiKey: config.apiKey || undefined });
  let abortController: AbortController | null = null;

  function toOpenAIMessages(systemPrompt: string, messages: Message[]): OpenAI.ChatCompletionMessageParam[] {
    const result: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
    ];
    for (const m of messages) {
      result.push({
        role: m.role === "system" ? "user" : m.role,
        content: m.content,
      } as OpenAI.ChatCompletionMessageParam);
    }
    return result;
  }

  function toOpenAITools(tools: ToolDefinition[]): OpenAITool[] {
    return tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  return {
    name: "agent-openai",

    async *run(params): AsyncGenerator<AgentEvent> {
      const { systemPrompt, messages, tools, toolExecutor } = params;
      abortController = new AbortController();

      const currentMessages = toOpenAIMessages(systemPrompt, messages);
      const openaiTools = toOpenAITools(tools);

      while (true) {
        const streamParams: OpenAI.ChatCompletionCreateParamsStreaming = {
          model,
          max_tokens: maxTokens,
          messages: currentMessages,
          stream: true,
        };

        if (openaiTools.length > 0) {
          streamParams.tools = openaiTools as any;
        }

        const stream = await client.chat.completions.create(streamParams, {
          signal: abortController.signal,
        });

        let responseText = "";
        const toolCalls: Map<number, { id: string; name: string; args: string }> = new Map();

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            responseText += delta.content;
            yield { type: "text_delta", text: delta.content };
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const existing = toolCalls.get(tc.index);
              if (existing) {
                existing.args += tc.function?.arguments ?? "";
              } else {
                toolCalls.set(tc.index, {
                  id: tc.id ?? "",
                  name: tc.function?.name ?? "",
                  args: tc.function?.arguments ?? "",
                });
              }
            }
          }
        }

        if (toolCalls.size > 0) {
          const assistantMsg: any = {
            role: "assistant",
            content: responseText || null,
            tool_calls: [...toolCalls.values()].map((tc) => ({
              id: tc.id,
              type: "function",
              function: { name: tc.name, arguments: tc.args },
            })),
          };
          currentMessages.push(assistantMsg);

          for (const tc of toolCalls.values()) {
            let input: any;
            try { input = JSON.parse(tc.args); } catch { input = {}; }

            yield { type: "tool_use", id: tc.id, name: tc.name, input };

            if (toolExecutor) {
              const result: ToolResult = await toolExecutor(tc.name, input);
              yield { type: "tool_result", id: tc.id, output: result.error ?? result.output };

              currentMessages.push({
                role: "tool",
                content: result.error ?? result.output,
                tool_call_id: tc.id,
              } as any);
            }
          }
        } else {
          if (responseText) {
            yield { type: "text_done", text: responseText };
          }
          yield { type: "done" };
          return;
        }
      }
    },

    abort() {
      abortController?.abort();
    },
  };
}
