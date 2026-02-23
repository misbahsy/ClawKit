import type { AgentRuntime, AgentEvent } from "clawkit:types";

export interface CodexSdkAgentConfig {
  name?: string;
  model?: string;
  apiKey?: string;
}

export default function createCodexSdkAgent(config: CodexSdkAgentConfig): AgentRuntime {
  const model = config.model ?? "codex-mini-latest";
  const apiKey = config.apiKey || process.env.OPENAI_API_KEY || "";

  return {
    name: "agent-codex-sdk",

    async *run(params): AsyncGenerator<AgentEvent> {
      const { systemPrompt, messages } = params;

      let codex: any;
      try {
        codex = await import("@openai/codex");
      } catch {
        yield { type: "error", error: new Error("@openai/codex SDK not installed. Run: npm install @openai/codex") };
        yield { type: "done" };
        return;
      }

      const prompt = messages.findLast((m) => m.role === "user")?.content ?? "";

      try {
        const client = new codex.CodexClient({ apiKey, model });
        const response = await client.run({ prompt: `${systemPrompt}\n\n${prompt}` });

        let responseText = "";
        if (typeof response === "string") {
          responseText = response;
        } else if (response && typeof response === "object") {
          responseText = String(
            response.text ?? response.content ?? response.output ?? ""
          );
          if (!responseText && "messages" in response && Array.isArray(response.messages)) {
            responseText = response.messages
              .filter((m: any) => m.role === "assistant" && m.content)
              .map((m: any) => m.content)
              .join("");
          }
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
