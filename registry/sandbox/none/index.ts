import type { Sandbox, ExecEvent } from "clawkit:types";
import { spawn } from "node:child_process";

export interface NoSandboxConfig {}

export default function createNoSandbox(_config: NoSandboxConfig): Sandbox {
  return {
    name: "sandbox-none",

    async *execute(params): AsyncGenerator<ExecEvent> {
      const { command, args, cwd, env, timeout } = params;

      const child = spawn(command, args, {
        cwd: cwd ?? process.cwd(),
        env: { ...process.env, ...env },
      });

      let timer: ReturnType<typeof setTimeout> | undefined;
      if (timeout) {
        timer = setTimeout(() => child.kill("SIGTERM"), timeout);
      }

      const events: ExecEvent[] = [];
      let done = false;

      child.stdout.on("data", (data: Buffer) => {
        events.push({ type: "stdout", data: data.toString() });
      });

      child.stderr.on("data", (data: Buffer) => {
        events.push({ type: "stderr", data: data.toString() });
      });

      const exitPromise = new Promise<number>((resolve) => {
        child.on("close", (code) => resolve(code ?? 1));
        child.on("error", () => resolve(1));
      });

      while (!done) {
        while (events.length > 0) {
          yield events.shift()!;
        }
        // Check if process has exited
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
      // No-op for passthrough sandbox
    },
  };
}
