import type { AgentRuntime, AgentEvent, Message, ToolDefinition } from "clawkit:types";
import { Ollama } from "ollama";

export interface OllamaAgentConfig {
  name?: string;
  model?: string;
  host?: string;
}

export default function createOllamaAgent(config: OllamaAgentConfig): AgentRuntime {
  const model = config.model ?? "llama3.2";
  const host = config.host ?? "http://localhost:11434";
  const client = new Ollama({ host });
  let aborted = false;

  function toOllamaMessages(systemPrompt: string, messages: Message[]): Array<{ role: string; content: string }> {
    const result: Array<{ role: string; content: string }> = [
      { role: "system", content: systemPrompt },
    ];
    for (const m of messages) {
      result.push({ role: m.role, content: m.content });
    }
    return result;
  }

  function toOllamaTools(tools: ToolDefinition[]): any[] {
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
    name: "agent-ollama",

    async *run(params): AsyncGenerator<AgentEvent> {
      const { systemPrompt, messages, tools, toolExecutor } = params;
      aborted = false;

      const currentMessages = toOllamaMessages(systemPrompt, messages);
      const ollamaTools = toOllamaTools(tools);

      while (!aborted) {
        let responseText = "";
        const toolCalls: Array<{ name: string; arguments: any }> = [];

        const response = await client.chat({
          model,
          messages: currentMessages,
          tools: ollamaTools.length > 0 ? ollamaTools : undefined,
          stream: true,
        });

        for await (const chunk of response) {
          if (aborted) break;
          if (chunk.message?.content) {
            responseText += chunk.message.content;
            yield { type: "text_delta", text: chunk.message.content };
          }
          if (chunk.message?.tool_calls) {
            for (const tc of chunk.message.tool_calls) {
              toolCalls.push({ name: tc.function.name, arguments: tc.function.arguments });
            }
          }
        }

        if (toolCalls.length > 0) {
          currentMessages.push({ role: "assistant", content: responseText });

          for (let i = 0; i < toolCalls.length; i++) {
            const tc = toolCalls[i];
            const id = `tool_${i}_${Date.now()}`;
            yield { type: "tool_use", id, name: tc.name, input: tc.arguments };
            if (toolExecutor) {
              const result = await toolExecutor(tc.name, tc.arguments);
              yield { type: "tool_result", id, output: result.error ?? result.output };
              currentMessages.push({ role: "tool", content: result.error ?? result.output });
            }
          }
        } else {
          if (responseText) yield { type: "text_done", text: responseText };
          yield { type: "done" };
          return;
        }
      }
    },

    abort() {
      aborted = true;
      client.abort();
    },
  };
}
