import type { AgentRuntime, AgentEvent, Message, ToolDefinition } from "clawkit:types";

export interface OpenRouterAgentConfig {
  name?: string;
  model?: string;
  maxTokens?: number;
  apiKey?: string;
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAITool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, any> };
}

export default function createOpenRouterAgent(config: OpenRouterAgentConfig): AgentRuntime {
  const model = config.model ?? "anthropic/claude-sonnet-4-20250514";
  const maxTokens = config.maxTokens ?? 16384;
  const apiKey = config.apiKey || process.env.OPENROUTER_API_KEY || "";
  const baseUrl = "https://openrouter.ai/api/v1";
  let abortController: AbortController | null = null;

  function toOpenAIMessages(systemPrompt: string, messages: Message[]): OpenAIMessage[] {
    const result: OpenAIMessage[] = [{ role: "system", content: systemPrompt }];
    for (const m of messages) {
      result.push({
        role: m.role === "system" ? "user" : m.role,
        content: m.content,
      });
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

  async function chatCompletion(
    messages: OpenAIMessage[],
    tools: OpenAITool[],
    signal: AbortSignal,
  ): Promise<{ content: string | null; toolCalls: OpenAIToolCall[]; usage: { prompt_tokens: number; completion_tokens: number } }> {
    const body: Record<string, any> = {
      model,
      max_tokens: maxTokens,
      messages,
    };
    if (tools.length > 0) {
      body.tools = tools;
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://github.com/menloparklab/clawkit",
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenRouter API error ${response.status}: ${text}`);
    }

    const data = await response.json() as any;
    const choice = data.choices?.[0];
    return {
      content: choice?.message?.content ?? null,
      toolCalls: choice?.message?.tool_calls ?? [],
      usage: data.usage ?? { prompt_tokens: 0, completion_tokens: 0 },
    };
  }

  return {
    name: "agent-openrouter",

    async *run(params): AsyncGenerator<AgentEvent> {
      const { systemPrompt, messages, tools, toolExecutor } = params;
      abortController = new AbortController();

      const currentMessages = toOpenAIMessages(systemPrompt, messages);
      const openaiTools = toOpenAITools(tools);

      while (true) {
        const result = await chatCompletion(currentMessages, openaiTools, abortController.signal);

        if (result.content) {
          yield { type: "text_delta", text: result.content };
        }

        if (result.toolCalls.length > 0) {
          currentMessages.push({
            role: "assistant",
            content: result.content,
            tool_calls: result.toolCalls,
          });

          for (const tc of result.toolCalls) {
            let input: any;
            try { input = JSON.parse(tc.function.arguments); } catch { input = {}; }

            yield { type: "tool_use", id: tc.id, name: tc.function.name, input };

            if (toolExecutor) {
              const toolResult = await toolExecutor(tc.function.name, input);
              yield { type: "tool_result", id: tc.id, output: toolResult.error ?? toolResult.output };
              currentMessages.push({
                role: "tool",
                content: toolResult.error ?? toolResult.output,
                tool_call_id: tc.id,
              });
            }
          }
        } else {
          if (result.content) {
            yield { type: "text_done", text: result.content };
          }
          yield {
            type: "done",
            usage: {
              inputTokens: result.usage.prompt_tokens,
              outputTokens: result.usage.completion_tokens,
            },
          };
          return;
        }
      }
    },

    abort() {
      abortController?.abort();
    },
  };
}
