import type { Sandbox, ExecEvent } from "clawkit:types";
import { spawn } from "node:child_process";
import { resolve, relative, isAbsolute } from "node:path";

export interface WorkspaceScopedSandboxConfig {
  name?: string;
  workspaceDir?: string;
  allowedCommands?: string[];
  timeout?: number;
}

const DEFAULT_ALLOWED = ["node", "npx", "npm", "cat", "ls", "echo", "grep", "find", "wc"];

export default function createWorkspaceScopedSandbox(config: WorkspaceScopedSandboxConfig): Sandbox {
  const workspaceDir = resolve(config.workspaceDir ?? "./workspace");
  const allowedCommands = config.allowedCommands ?? DEFAULT_ALLOWED;
  const defaultTimeout = config.timeout ?? 30000;

  function isPathSafe(targetPath: string): boolean {
    const resolved = isAbsolute(targetPath) ? resolve(targetPath) : resolve(workspaceDir, targetPath);
    const rel = relative(workspaceDir, resolved);
    return !rel.startsWith("..") && !isAbsolute(rel);
  }

  function validateArgs(args: string[]): void {
    for (const arg of args) {
      // Skip flags
      if (arg.startsWith("-")) continue;
      // Check paths that look like file references
      if (arg.includes("/") || arg.includes("\\")) {
        if (!isPathSafe(arg)) {
          throw new Error(`Path escapes workspace: ${arg}`);
        }
      }
    }
  }

  return {
    name: "sandbox-workspace-scoped",

    async *execute(params): AsyncGenerator<ExecEvent> {
      const { command, args, env, timeout } = params;

      if (!allowedCommands.includes(command)) {
        yield { type: "stderr", data: `Command not allowed: ${command}. Allowed: ${allowedCommands.join(", ")}` };
        yield { type: "exit", code: 1 };
        return;
      }

      try {
        validateArgs(args);
      } catch (err: any) {
        yield { type: "stderr", data: err.message };
        yield { type: "exit", code: 1 };
        return;
      }

      const child = spawn(command, args, {
        cwd: workspaceDir,
        env: { ...process.env, ...env },
      });

      const effectiveTimeout = timeout ?? defaultTimeout;
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (effectiveTimeout) {
        timer = setTimeout(() => child.kill("SIGTERM"), effectiveTimeout);
      }

      const events: ExecEvent[] = [];
      let done = false;

      child.stdout.on("data", (data: Buffer) => {
        events.push({ type: "stdout", data: data.toString() });
      });

      child.stderr.on("data", (data: Buffer) => {
        events.push({ type: "stderr", data: data.toString() });
      });

      const exitPromise = new Promise<number>((res) => {
        child.on("close", (code) => res(code ?? 1));
        child.on("error", () => res(1));
      });

      while (!done) {
        while (events.length > 0) {
          yield events.shift()!;
        }
        const raceResult = await Promise.race([
          exitPromise.then((code) => ({ type: "exit" as const, code })),
          new Promise<null>((r) => setTimeout(() => r(null), 10)),
        ]);
        if (raceResult && raceResult.type === "exit") {
          while (events.length > 0) {
            yield events.shift()!;
          }
          if (timer) clearTimeout(timer);
          yield { type: "exit", code: raceResult.code };
          done = true;
        }
      }
    },

    async cleanup() {
      // No persistent resources to clean up
    },
  };
}
