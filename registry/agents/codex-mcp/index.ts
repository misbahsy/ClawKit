import type { AgentRuntime, AgentEvent } from "clawkit:types";
import { spawn, type ChildProcess } from "node:child_process";

export interface CodexMcpAgentConfig {
  name?: string;
  model?: string;
  timeout?: number;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

export default function createCodexMcpAgent(config: CodexMcpAgentConfig): AgentRuntime {
  const timeout = config.timeout ?? 120000;
  let child: ChildProcess | null = null;
  let requestId = 0;
  let abortController: AbortController | null = null;
  const pendingRequests = new Map<number, {
    resolve: (result: any) => void;
    reject: (error: Error) => void;
  }>();

  function ensureProcess(): ChildProcess {
    if (child && !child.killed) return child;

    const args = ["codex", "--mcp"];
    if (config.model) {
      args.push("--model", config.model);
    }

    child = spawn("npx", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    let buffer = "";
    child.stdout?.on("data", (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed) as JsonRpcResponse;
          if (msg.id != null && pendingRequests.has(msg.id)) {
            const pending = pendingRequests.get(msg.id)!;
            pendingRequests.delete(msg.id);
            if (msg.error) {
              pending.reject(new Error(msg.error.message));
            } else {
              pending.resolve(msg.result);
            }
          }
        } catch {
          // ignore non-JSON lines
        }
      }
    });

    child.on("exit", () => {
      for (const [id, pending] of pendingRequests) {
        pending.reject(new Error("Codex MCP process exited"));
        pendingRequests.delete(id);
      }
      child = null;
    });

    return child;
  }

  function sendRequest(method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const proc = ensureProcess();
      const id = ++requestId;
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error(`Codex MCP request timed out after ${timeout}ms`));
      }, timeout);

      pendingRequests.set(id, {
        resolve: (result) => { clearTimeout(timer); resolve(result); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });

      const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
      proc.stdin?.write(JSON.stringify(request) + "\n");
    });
  }

  return {
    name: "agent-codex-mcp",

    async *run(params): AsyncGenerator<AgentEvent> {
      const { messages } = params;
      abortController = new AbortController();

      const userMessage = messages.findLast((m) => m.role === "user")?.content ?? "";

      try {
        // Initialize MCP connection
        await sendRequest("initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "clawkit-codex-mcp", version: "1.0.0" },
        });

        // Send the prompt via tools/call
        const result = await sendRequest("tools/call", {
          name: "codex",
          arguments: { prompt: userMessage },
        });

        const responseText = typeof result === "string"
          ? result
          : result?.content?.[0]?.text ?? JSON.stringify(result);

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

    abort() {
      abortController?.abort();
      if (child && !child.killed) {
        child.kill("SIGTERM");
        child = null;
      }
      for (const [id, pending] of pendingRequests) {
        pending.reject(new Error("Aborted"));
        pendingRequests.delete(id);
      }
    },
  };
}
