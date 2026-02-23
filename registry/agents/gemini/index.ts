import type { AgentRuntime, AgentEvent, Message, ToolDefinition, ToolResult } from "clawkit:types";
import { GoogleGenerativeAI, type Content, type Part, type FunctionDeclaration, type Tool as GeminiTool } from "@google/generative-ai";

export interface GeminiAgentConfig {
  name?: string;
  model?: string;
  maxTokens?: number;
  apiKey?: string;
}

interface GeminiToolCall {
  name: string;
  args: Record<string, any>;
}

export default function createGeminiAgent(config: GeminiAgentConfig): AgentRuntime {
  const model = config.model ?? "gemini-pro";
  const maxTokens = config.maxTokens ?? 8192;
  const apiKey = config.apiKey || process.env.GOOGLE_API_KEY || "";
  const client = new GoogleGenerativeAI(apiKey);
  let abortController: AbortController | null = null;

  function toGeminiContents(systemPrompt: string, messages: Message[]): { system: string; contents: Content[] } {
    const contents: Content[] = [];
    for (const m of messages) {
      const role = m.role === "assistant" ? "model" : "user";
      contents.push({
        role,
        parts: [{ text: m.content }],
      });
    }
    return { system: systemPrompt, contents };
  }

  function toGeminiTools(tools: ToolDefinition[]): GeminiTool[] {
    if (tools.length === 0) return [];

    const functionDeclarations: FunctionDeclaration[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters as any,
    }));

    return [{ functionDeclarations }];
  }

  function extractFunctionCalls(parts: Part[]): GeminiToolCall[] {
    const calls: GeminiToolCall[] = [];
    for (const part of parts) {
      if (part.functionCall) {
        calls.push({
          name: part.functionCall.name,
          args: part.functionCall.args as Record<string, any>,
        });
      }
    }
    return calls;
  }

  return {
    name: "agent-gemini",

    async *run(params): AsyncGenerator<AgentEvent> {
      const { systemPrompt, messages, tools, toolExecutor } = params;
      abortController = new AbortController();

      const geminiModel = client.getGenerativeModel({
        model,
        generationConfig: { maxOutputTokens: maxTokens },
        tools: toGeminiTools(tools),
        systemInstruction: systemPrompt,
      });

      const { contents } = toGeminiContents(systemPrompt, messages);
      let currentContents = [...contents];

      while (true) {
        const result = await geminiModel.generateContentStream({
          contents: currentContents,
        });

        let responseText = "";
        let allParts: Part[] = [];

        for await (const chunk of result.stream) {
          const text = chunk.text?.();
          if (text) {
            responseText += text;
            yield { type: "text_delta", text };
          }

          const candidates = chunk.candidates ?? [];
          for (const candidate of candidates) {
            if (candidate.content?.parts) {
              allParts.push(...candidate.content.parts);
            }
          }
        }

        const response = await result.response;
        const usageMetadata = response.usageMetadata;

        // Check for function calls in collected parts
        const functionCalls = extractFunctionCalls(allParts);

        if (functionCalls.length > 0) {
          const functionResponseParts: Part[] = [];

          for (const fc of functionCalls) {
            const callId = `fc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            yield { type: "tool_use", id: callId, name: fc.name, input: fc.args };

            if (toolExecutor) {
              const toolResult: ToolResult = await toolExecutor(fc.name, fc.args);
              const output = toolResult.error ?? toolResult.output;
              yield { type: "tool_result", id: callId, output };

              functionResponseParts.push({
                functionResponse: {
                  name: fc.name,
                  response: { result: output },
                },
              });
            }
          }

          // Add assistant response with function calls
          currentContents.push({
            role: "model",
            parts: allParts,
          });

          // Add function responses
          currentContents.push({
            role: "user",
            parts: functionResponseParts,
          });
        } else {
          if (responseText) {
            yield { type: "text_done", text: responseText };
          }
          yield {
            type: "done",
            usage: {
              inputTokens: usageMetadata?.promptTokenCount ?? 0,
              outputTokens: usageMetadata?.candidatesTokenCount ?? 0,
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
