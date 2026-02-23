import type { AgentRuntime, AgentEvent, Message, ToolDefinition, ToolResult } from "clawkit:types";

export interface PiEmbeddedConfig {
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  sessionManagement?: boolean;
  compactionThreshold?: number;
  modelFailover?: string[];
}

export default function createPiEmbeddedAgent(config: PiEmbeddedConfig): AgentRuntime {
  const model = config.model ?? "pi-default";
  const baseUrl = config.baseUrl ?? "http://localhost:8080";
  const maxTokens = config.maxTokens ?? 4096;
  const sessionManagement = config.sessionManagement ?? true;
  const compactionThreshold = config.compactionThreshold ?? 100;
  const modelFailover = config.modelFailover ?? [];
  let aborted = false;
  let sessionId: string | null = null;

  async function tryRequest(url: string, body: any, models: string[]): Promise<Response> {
    let lastError: Error | null = null;
    for (const m of models) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
          },
          body: JSON.stringify({ ...body, model: m }),
        });
        if (res.ok) return res;
        lastError = new Error(`Pi API error: ${res.status}`);
      } catch (err: any) {
        lastError = err;
      }
    }
    throw lastError ?? new Error("All models failed");
  }

  return {
    name: "agent-pi-embedded",

    async *run(params: {
      systemPrompt: string;
      messages: Message[];
      tools: ToolDefinition[];
      toolExecutor?: (name: string, input: any) => Promise<ToolResult>;
      onEvent?: (event: AgentEvent) => void;
    }): AsyncIterable<AgentEvent> {
      aborted = false;
      const models = [model, ...modelFailover];

      // Session compaction
      let msgs = params.messages;
      if (sessionManagement && msgs.length > compactionThreshold) {
        const summary = msgs.slice(0, -20).map(m => `${m.role}: ${m.content.slice(0, 100)}`).join("\n");
        msgs = [
          { role: "system" as const, content: `[Compacted history]\n${summary}` },
          ...msgs.slice(-20),
        ];
      }

      const body = {
        model,
        system: params.systemPrompt,
        messages: msgs.map(m => ({ role: m.role, content: m.content })),
        tools: params.tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
        max_tokens: maxTokens,
        stream: true,
      };

      try {
        const res = await tryRequest(`${baseUrl}/v1/chat`, body, models);
        const reader = res.body?.getReader();
        if (!reader) {
          yield { type: "error", error: new Error("No response body") };
          return;
        }

        const decoder = new TextDecoder();
        let fullText = "";
        let buffer = "";

        while (!aborted) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;

            try {
              const event = JSON.parse(data);

              if (event.type === "text_delta" || event.delta?.text) {
                const text = event.delta?.text ?? event.text ?? "";
                fullText += text;
                const evt: AgentEvent = { type: "text_delta", text };
                yield evt;
                params.onEvent?.(evt);
              }

              if (event.type === "tool_use" || event.tool_call) {
                const toolCall = event.tool_call ?? event;
                const evt: AgentEvent = {
                  type: "tool_use",
                  id: toolCall.id ?? `tool_${Date.now()}`,
                  name: toolCall.name,
                  input: toolCall.input ?? toolCall.arguments ?? {},
                };
                yield evt;
                params.onEvent?.(evt);

                if (params.toolExecutor) {
                  const result = await params.toolExecutor(toolCall.name, toolCall.input ?? toolCall.arguments ?? {});
                  const resultEvt: AgentEvent = { type: "tool_result", id: evt.id, output: result.output };
                  yield resultEvt;
                  params.onEvent?.(resultEvt);
                }
              }
            } catch { /* skip unparseable lines */ }
          }
        }

        if (fullText) {
          const doneEvt: AgentEvent = { type: "text_done", text: fullText };
          yield doneEvt;
          params.onEvent?.(doneEvt);
        }

        yield { type: "done" };
      } catch (err: any) {
        const errEvt: AgentEvent = { type: "error", error: err };
        yield errEvt;
        params.onEvent?.(errEvt);
      }
    },

    abort() {
      aborted = true;
    },
  };
}
