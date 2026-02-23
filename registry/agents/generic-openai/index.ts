import type { AgentRuntime, AgentEvent, Message, ToolDefinition, ToolResult } from "clawkit:types";

export interface GenericOpenAIConfig {
  name?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
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

export default function createGenericOpenAIAgent(config: GenericOpenAIConfig): AgentRuntime {
  const model = config.model ?? "gpt-4o";
  const maxTokens = config.maxTokens ?? 4096;
  const apiKey = config.apiKey || process.env.OPENAI_API_KEY || "";
  const baseUrl = (config.baseUrl || "http://localhost:11434").replace(/\/$/, "");
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

  async function* parseSSE(response: Response): AsyncGenerator<any> {
    const reader = response.body!.getReader();
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
            yield JSON.parse(data);
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async function streamChat(
    messages: OpenAIMessage[],
    tools: OpenAITool[],
    signal: AbortSignal,
  ): Promise<Response> {
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
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API error ${response.status}: ${text}`);
    }

    return response;
  }

  return {
    name: "agent-generic-openai",

    async *run(params): AsyncGenerator<AgentEvent> {
      const { systemPrompt, messages, tools, toolExecutor } = params;
      abortController = new AbortController();

      const currentMessages = toOpenAIMessages(systemPrompt, messages);
      const openaiTools = toOpenAITools(tools);

      while (true) {
        const response = await streamChat(currentMessages, openaiTools, abortController.signal);

        let responseText = "";
        const toolCalls: Map<number, { id: string; name: string; args: string }> = new Map();

        for await (const chunk of parseSSE(response)) {
          const delta = chunk.choices?.[0]?.delta;
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
          currentMessages.push({
            role: "assistant",
            content: responseText || null,
            tool_calls: [...toolCalls.values()].map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: { name: tc.name, arguments: tc.args },
            })),
          });

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
              });
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
