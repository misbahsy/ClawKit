import type { Sandbox, ExecEvent, MountPoint } from "clawkit:types";

export interface WasmSandboxConfig {
  wasmDir?: string;
  capabilities?: string[];
  rateLimit?: { maxCalls: number; windowMs: number };
}

interface CallTracker {
  calls: number[];
}

export default function createWasmSandbox(config: WasmSandboxConfig): Sandbox {
  const capabilities = new Set(config.capabilities ?? ["fs.read"]);
  const rateLimit = config.rateLimit ?? { maxCalls: 100, windowMs: 60000 };
  const callTrackers = new Map<string, CallTracker>();

  function checkRateLimit(tool: string): boolean {
    const now = Date.now();
    let tracker = callTrackers.get(tool);
    if (!tracker) {
      tracker = { calls: [] };
      callTrackers.set(tool, tracker);
    }
    tracker.calls = tracker.calls.filter(t => now - t < rateLimit.windowMs);
    if (tracker.calls.length >= rateLimit.maxCalls) return false;
    tracker.calls.push(now);
    return true;
  }

  function checkCapability(command: string): boolean {
    // Map commands to capabilities
    if (command.includes("read") || command.includes("cat")) return capabilities.has("fs.read");
    if (command.includes("write") || command.includes("echo") || command.includes("tee")) return capabilities.has("fs.write");
    if (command.includes("curl") || command.includes("fetch") || command.includes("wget")) return capabilities.has("network");
    if (command.includes("exec") || command.includes("spawn")) return capabilities.has("process");
    return capabilities.has("exec");
  }

  return {
    name: "sandbox-wasm",

    async *execute(params: {
      command: string;
      args: string[];
      cwd?: string;
      mounts?: MountPoint[];
      env?: Record<string, string>;
      timeout?: number;
      capabilities?: string[];
    }): AsyncIterable<ExecEvent> {
      const fullCommand = [params.command, ...params.args].join(" ");

      // Capability check
      if (!checkCapability(fullCommand)) {
        yield { type: "stderr", data: `Permission denied: command requires capability not granted` };
        yield { type: "exit", code: 126 };
        return;
      }

      // Rate limit check
      if (!checkRateLimit(params.command)) {
        yield { type: "stderr", data: `Rate limit exceeded for ${params.command}` };
        yield { type: "exit", code: 429 };
        return;
      }

      // WASM execution (simplified - in production would use Extism/Wasmtime)
      // Falls back to restricted child_process execution
      const { spawn } = await import("node:child_process");
      const timeout = params.timeout ?? 30000;

      // Preserve PATH for command resolution; overlay with user-provided env
      const sandboxEnv: Record<string, string> = {};
      if (process.env.PATH) sandboxEnv.PATH = process.env.PATH;
      Object.assign(sandboxEnv, params.env);

      const child = spawn(params.command, params.args, {
        cwd: params.cwd,
        env: sandboxEnv,
        timeout,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];

      if (child.stdout) {
        for await (const chunk of child.stdout) {
          const text = chunk.toString();
          stdoutChunks.push(text);
          yield { type: "stdout", data: text };
        }
      }

      if (child.stderr) {
        for await (const chunk of child.stderr) {
          const text = chunk.toString();
          stderrChunks.push(text);
          yield { type: "stderr", data: text };
        }
      }

      const exitCode = await new Promise<number>((resolve) => {
        child.on("close", (code) => resolve(code ?? 1));
        child.on("error", () => resolve(1));
      });

      yield { type: "exit", code: exitCode };
    },

    async cleanup(): Promise<void> {
      callTrackers.clear();
    },
  };
}
