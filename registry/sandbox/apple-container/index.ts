import type { Sandbox, ExecEvent, MountPoint } from "clawkit:types";
import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";

export interface AppleContainerSandboxConfig {
  image?: string;
  memoryLimit?: number;
  timeout?: number;
}

export default function createAppleContainerSandbox(
  config: AppleContainerSandboxConfig,
): Sandbox {
  const image = config.image ?? "default";
  const memoryLimit = config.memoryLimit ?? 512 * 1024 * 1024;
  const defaultTimeout = config.timeout ?? 30000;
  const activeContainers: string[] = [];

  function containerExec(
    args: string[],
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve) => {
      execFile("container", args, { timeout: 30000 }, (error, stdout, stderr) => {
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          code: error ? (error as any).code ?? 1 : 0,
        });
      });
    });
  }

  return {
    name: "sandbox-apple-container",

    async *execute(params: {
      command: string;
      args: string[];
      cwd?: string;
      mounts?: MountPoint[];
      env?: Record<string, string>;
      timeout?: number;
    }): AsyncGenerator<ExecEvent> {
      const containerId = `clawkit-${randomUUID().slice(0, 8)}`;
      const effectiveTimeout = params.timeout ?? defaultTimeout;

      // Create the container
      const createArgs = [
        "create",
        "--name",
        containerId,
        "--image",
        image,
        "--memory",
        String(memoryLimit),
      ];

      if (params.mounts) {
        for (const mount of params.mounts) {
          const mode = mount.readonly ? "ro" : "rw";
          createArgs.push("--mount", `${mount.hostPath}:${mount.containerPath}:${mode}`);
        }
      }

      const createResult = await containerExec(createArgs);
      if (createResult.code !== 0) {
        yield { type: "stderr", data: `Failed to create container: ${createResult.stderr}` };
        yield { type: "exit", code: 1 };
        return;
      }

      activeContainers.push(containerId);

      // Start and exec
      await containerExec(["start", containerId]);

      const execArgs = ["exec", containerId, "--"];
      if (params.cwd) {
        execArgs.push("sh", "-c", `cd ${params.cwd} && ${params.command} ${params.args.join(" ")}`);
      } else {
        execArgs.push(params.command, ...params.args);
      }

      const child = spawn("container", execArgs, {
        env: { ...process.env, ...params.env },
      });

      let timer: ReturnType<typeof setTimeout> | undefined;
      if (effectiveTimeout) {
        timer = setTimeout(() => {
          child.kill("SIGTERM");
          containerExec(["stop", containerId]).catch(() => {});
        }, effectiveTimeout);
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

      // Clean up the container
      try {
        await containerExec(["stop", containerId]);
        await containerExec(["rm", containerId]);
        const idx = activeContainers.indexOf(containerId);
        if (idx >= 0) activeContainers.splice(idx, 1);
      } catch {
        /* ignore */
      }
    },

    async cleanup() {
      for (const id of activeContainers) {
        try {
          await containerExec(["stop", id]);
          await containerExec(["rm", id]);
        } catch {
          /* ignore */
        }
      }
      activeContainers.length = 0;
    },
  };
}
