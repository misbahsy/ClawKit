import type { AgentRuntime, AgentEvent, Message, ToolDefinition, ToolResult } from "clawkit:types";

export interface DeepSeekAgentConfig {
  name?: string;
  model?: string;
  maxTokens?: number;
  apiKey?: string;
  baseUrl?: string;
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

interface SSEDelta {
  role?: string;
  content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

export default function createDeepSeekAgent(config: DeepSeekAgentConfig): AgentRuntime {
  const model = config.model ?? "deepseek-chat";
  const maxTokens = config.maxTokens ?? 8192;
  const apiKey = config.apiKey || process.env.DEEPSEEK_API_KEY || "";
  const baseUrl = config.baseUrl ?? "https://api.deepseek.com";
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

  async function* parseSSEStream(body: ReadableStream<Uint8Array>): AsyncGenerator<SSEDelta> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") return;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;
            if (delta) yield delta;
          } catch {
            // skip malformed SSE lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async function streamCompletion(
    messages: OpenAIMessage[],
    tools: OpenAITool[],
    signal: AbortSignal,
  ): Promise<{
    content: string | null;
    toolCalls: OpenAIToolCall[];
    usage: { prompt_tokens: number; completion_tokens: number };
  }> {
    const body: Record<string, any> = {
      model,
      max_tokens: maxTokens,
      messages,
      stream: true,
    };
    if (tools.length > 0) {
      body.tools = tools;
    }

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`DeepSeek API error ${response.status}: ${text}`);
    }

    if (!response.body) {
      throw new Error("No response body from DeepSeek API");
    }

    let content = "";
    const toolCallAccumulator = new Map<number, { id: string; name: string; arguments: string }>();

    for await (const delta of parseSSEStream(response.body)) {
      if (delta.content) {
        content += delta.content;
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCallAccumulator.get(tc.index);
          if (!existing) {
            toolCallAccumulator.set(tc.index, {
              id: tc.id ?? "",
              name: tc.function?.name ?? "",
              arguments: tc.function?.arguments ?? "",
            });
          } else {
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name += tc.function.name;
            if (tc.function?.arguments) existing.arguments += tc.function.arguments;
          }
        }
      }
    }

    const toolCalls: OpenAIToolCall[] = Array.from(toolCallAccumulator.values()).map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.name, arguments: tc.arguments },
    }));

    return {
      content: content || null,
      toolCalls,
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    };
  }

  return {
    name: "agent-deepseek",

    async *run(params): AsyncGenerator<AgentEvent> {
      const { systemPrompt, messages, tools, toolExecutor } = params;
      abortController = new AbortController();

      const currentMessages = toOpenAIMessages(systemPrompt, messages);
      const openaiTools = toOpenAITools(tools);

      while (true) {
        const result = await streamCompletion(currentMessages, openaiTools, abortController.signal);

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
              const toolResult: ToolResult = await toolExecutor(tc.function.name, input);
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
