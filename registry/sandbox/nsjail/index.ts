import type { Sandbox, ExecEvent, MountPoint } from "clawkit:types";
import { spawn } from "node:child_process";

export interface NsjailSandboxConfig {
  nsjailPath?: string;
  memoryLimit?: number;
  timeLimit?: number;
  networkAccess?: boolean;
}

export default function createNsjailSandbox(config: NsjailSandboxConfig): Sandbox {
  const nsjailPath = config.nsjailPath ?? "/usr/bin/nsjail";
  const memoryLimit = config.memoryLimit ?? 512 * 1024 * 1024;
  const timeLimit = config.timeLimit ?? 30;
  const networkAccess = config.networkAccess ?? false;
  const activeProcesses: Array<ReturnType<typeof spawn>> = [];

  function buildArgs(params: {
    command: string;
    args: string[];
    cwd?: string;
    mounts?: MountPoint[];
    env?: Record<string, string>;
  }): string[] {
    const args: string[] = [
      "--mode",
      "o", // once mode
      "--time_limit",
      String(timeLimit),
      "--rlimit_as",
      String(Math.ceil(memoryLimit / (1024 * 1024))), // MB
      "--keep_caps",
    ];

    if (!networkAccess) {
      args.push("--disable_clone_newnet");
    }

    if (params.cwd) {
      args.push("--cwd", params.cwd);
    }

    // Default mount: / as read-only
    args.push("--rw");

    if (params.mounts) {
      for (const mount of params.mounts) {
        if (mount.readonly) {
          args.push("-R", `${mount.hostPath}:${mount.containerPath}`);
        } else {
          args.push("-B", `${mount.hostPath}:${mount.containerPath}`);
        }
      }
    }

    if (params.env) {
      for (const [key, value] of Object.entries(params.env)) {
        args.push("--env", `${key}=${value}`);
      }
    }

    args.push("--", params.command, ...params.args);
    return args;
  }

  return {
    name: "sandbox-nsjail",

    async *execute(params: {
      command: string;
      args: string[];
      cwd?: string;
      mounts?: MountPoint[];
      env?: Record<string, string>;
      timeout?: number;
    }): AsyncGenerator<ExecEvent> {
      const nsjailArgs = buildArgs(params);

      const child = spawn(nsjailPath, nsjailArgs, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      activeProcesses.push(child);

      const effectiveTimeout = params.timeout ?? timeLimit * 1000;
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (effectiveTimeout) {
        timer = setTimeout(() => child.kill("SIGTERM"), effectiveTimeout);
      }

      const events: ExecEvent[] = [];
      let done = false;

      child.stdout!.on("data", (data: Buffer) => {
        events.push({ type: "stdout", data: data.toString() });
      });

      child.stderr!.on("data", (data: Buffer) => {
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

      // Clean up
      const idx = activeProcesses.indexOf(child);
      if (idx >= 0) activeProcesses.splice(idx, 1);
    },

    async cleanup() {
      for (const proc of activeProcesses) {
        try {
          proc.kill("SIGTERM");
        } catch {
          /* ignore */
        }
      }
      activeProcesses.length = 0;
    },
  };
}
