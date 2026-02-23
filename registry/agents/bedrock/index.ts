import type { AgentRuntime, AgentEvent, Message, ToolDefinition, ToolResult } from "clawkit:types";
import {
  BedrockRuntimeClient,
  InvokeModelWithResponseStreamCommand,
  type InvokeModelWithResponseStreamCommandInput,
} from "@aws-sdk/client-bedrock-runtime";

export interface BedrockAgentConfig {
  name?: string;
  model?: string;
  region?: string;
  maxTokens?: number;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
}

interface BedrockContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: any;
}

interface BedrockStreamEvent {
  type: string;
  index?: number;
  content_block?: BedrockContentBlock;
  delta?: {
    type: string;
    text?: string;
    partial_json?: string;
  };
  message?: {
    stop_reason?: string;
    usage?: { input_tokens: number; output_tokens: number };
  };
  "amazon-bedrock-invocationMetrics"?: {
    inputTokenCount: number;
    outputTokenCount: number;
  };
}

export default function createBedrockAgent(config: BedrockAgentConfig): AgentRuntime {
  const model = config.model ?? "anthropic.claude-3-sonnet-20240229-v1:0";
  const region = config.region ?? "us-east-1";
  const maxTokens = config.maxTokens ?? 4096;

  const clientConfig: any = { region };
  if (config.credentials) {
    clientConfig.credentials = config.credentials;
  }
  const client = new BedrockRuntimeClient(clientConfig);
  let abortController: AbortController | null = null;

  function toBedrockMessages(messages: Message[]): Array<{ role: string; content: Array<{ type: string; text: string }> }> {
    return messages.map((m) => ({
      role: m.role === "system" ? "user" : m.role,
      content: [{ type: "text", text: m.content }],
    }));
  }

  function toBedrockTools(tools: ToolDefinition[]): Array<{ name: string; description: string; input_schema: any }> {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  async function* invokeStream(
    systemPrompt: string,
    messages: Array<{ role: string; content: any }>,
    tools: Array<{ name: string; description: string; input_schema: any }>,
    signal: AbortSignal,
  ): AsyncGenerator<BedrockStreamEvent> {
    const body: Record<string, any> = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    };

    if (tools.length > 0) {
      body.tools = tools;
    }

    const input: InvokeModelWithResponseStreamCommandInput = {
      modelId: model,
      contentType: "application/json",
      accept: "application/json",
      body: new TextEncoder().encode(JSON.stringify(body)),
    };

    const command = new InvokeModelWithResponseStreamCommand(input);
    const response = await client.send(command, { abortSignal: signal });

    if (response.body) {
      for await (const event of response.body) {
        if (event.chunk?.bytes) {
          const decoded = new TextDecoder().decode(event.chunk.bytes);
          try {
            const parsed = JSON.parse(decoded) as BedrockStreamEvent;
            yield parsed;
          } catch {
            // skip malformed chunks
          }
        }
      }
    }
  }

  return {
    name: "agent-bedrock",

    async *run(params): AsyncGenerator<AgentEvent> {
      const { systemPrompt, messages, tools, toolExecutor } = params;
      abortController = new AbortController();

      const bedrockMessages = toBedrockMessages(messages);
      const bedrockTools = toBedrockTools(tools);
      let currentMessages = [...bedrockMessages];

      while (true) {
        let responseText = "";
        let stopReason = "";
        let inputTokens = 0;
        let outputTokens = 0;
        const contentBlocks: BedrockContentBlock[] = [];
        const partialJsonAccumulator = new Map<number, string>();

        for await (const event of invokeStream(systemPrompt, currentMessages, bedrockTools, abortController.signal)) {
          switch (event.type) {
            case "content_block_start": {
              if (event.content_block) {
                const idx = event.index ?? contentBlocks.length;
                contentBlocks[idx] = { ...event.content_block };
              }
              break;
            }
            case "content_block_delta": {
              if (event.delta?.type === "text_delta" && event.delta.text) {
                responseText += event.delta.text;
                yield { type: "text_delta", text: event.delta.text };
              }
              if (event.delta?.type === "input_json_delta" && event.delta.partial_json != null) {
                const idx = event.index ?? 0;
                const existing = partialJsonAccumulator.get(idx) ?? "";
                partialJsonAccumulator.set(idx, existing + event.delta.partial_json);
              }
              break;
            }
            case "message_delta": {
              if (event.message?.stop_reason) {
                stopReason = event.message.stop_reason;
              }
              if (event.message?.usage) {
                outputTokens = event.message.usage.output_tokens;
              }
              break;
            }
            case "message_start": {
              if ((event as any).message?.usage) {
                inputTokens = (event as any).message.usage.input_tokens ?? 0;
              }
              break;
            }
          }

          if (event["amazon-bedrock-invocationMetrics"]) {
            inputTokens = event["amazon-bedrock-invocationMetrics"].inputTokenCount;
            outputTokens = event["amazon-bedrock-invocationMetrics"].outputTokenCount;
          }
        }

        // Resolve tool use blocks with accumulated JSON
        for (const [idx, json] of partialJsonAccumulator) {
          if (contentBlocks[idx] && contentBlocks[idx].type === "tool_use") {
            try {
              contentBlocks[idx].input = JSON.parse(json);
            } catch {
              contentBlocks[idx].input = {};
            }
          }
        }

        const toolUseBlocks = contentBlocks.filter((b) => b.type === "tool_use" && b.id && b.name);

        if (stopReason === "tool_use" && toolUseBlocks.length > 0) {
          const toolResults: Array<{ type: string; tool_use_id: string; content: string }> = [];

          for (const block of toolUseBlocks) {
            yield { type: "tool_use", id: block.id!, name: block.name!, input: block.input };

            if (toolExecutor) {
              const result: ToolResult = await toolExecutor(block.name!, block.input);
              const output = result.error ?? result.output;
              yield { type: "tool_result", id: block.id!, output };
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id!,
                content: output,
              });
            }
          }

          // Build assistant content from all content blocks
          const assistantContent = contentBlocks.map((b) => {
            if (b.type === "text") return { type: "text", text: b.text ?? responseText };
            if (b.type === "tool_use") return { type: "tool_use", id: b.id, name: b.name, input: b.input };
            return b;
          });

          currentMessages.push({ role: "assistant", content: assistantContent });
          currentMessages.push({ role: "user", content: toolResults });
        } else {
          if (responseText) {
            yield { type: "text_done", text: responseText };
          }
          yield {
            type: "done",
            usage: { inputTokens, outputTokens },
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
