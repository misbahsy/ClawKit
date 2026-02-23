import type { Sandbox, ExecEvent, MountPoint } from "clawkit:types";
import Docker from "dockerode";
import { randomUUID } from "node:crypto";

export interface DockerOrchestratorSandboxConfig {
  image?: string;
  networkMode?: string;
  readOnlyRoot?: boolean;
  timeout?: number;
  memoryLimit?: number;
}

export default function createDockerOrchestratorSandbox(
  config: DockerOrchestratorSandboxConfig,
): Sandbox {
  const image = config.image ?? "node:20-slim";
  const networkMode = config.networkMode ?? "none";
  const readOnlyRoot = config.readOnlyRoot ?? true;
  const defaultTimeout = config.timeout ?? 30000;
  const memoryLimit = config.memoryLimit ?? 512 * 1024 * 1024;

  const docker = new Docker();
  const activeContainers: Docker.Container[] = [];

  async function ensureImage(imageName: string): Promise<void> {
    try {
      await docker.getImage(imageName).inspect();
    } catch {
      const stream = await docker.pull(imageName);
      await new Promise<void>((resolve, reject) => {
        docker.modem.followProgress(stream, (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  return {
    name: "sandbox-docker-orchestrator",

    async *execute(params: {
      command: string;
      args: string[];
      cwd?: string;
      mounts?: MountPoint[];
      env?: Record<string, string>;
      timeout?: number;
    }): AsyncGenerator<ExecEvent> {
      const jobToken = randomUUID();
      const effectiveTimeout = params.timeout ?? defaultTimeout;

      await ensureImage(image);

      const binds: string[] = [];
      if (params.mounts) {
        for (const mount of params.mounts) {
          const mode = mount.readonly ? "ro" : "rw";
          binds.push(`${mount.hostPath}:${mount.containerPath}:${mode}`);
        }
      }

      const envArray = [
        `CLAWKIT_JOB_TOKEN=${jobToken}`,
        ...(params.env ? Object.entries(params.env).map(([k, v]) => `${k}=${v}`) : []),
      ];

      const container = await docker.createContainer({
        Image: image,
        Cmd: [params.command, ...params.args],
        WorkingDir: params.cwd ?? "/workspace",
        Env: envArray,
        Labels: {
          "clawkit.orchestrator": "true",
          "clawkit.job-token": jobToken,
        },
        HostConfig: {
          Memory: memoryLimit,
          NetworkMode: networkMode,
          ReadonlyRootfs: readOnlyRoot,
          Binds: binds.length > 0 ? binds : undefined,
          Tmpfs: readOnlyRoot ? { "/tmp": "rw,noexec,nosuid,size=64m" } : undefined,
        },
        AttachStdout: true,
        AttachStderr: true,
      });

      activeContainers.push(container);

      const stream = await container.attach({ stream: true, stdout: true, stderr: true });
      await container.start();

      const events: ExecEvent[] = [];
      let done = false;

      stream.on("data", (chunk: Buffer) => {
        let offset = 0;
        while (offset < chunk.length) {
          if (offset + 8 > chunk.length) {
            events.push({ type: "stdout", data: chunk.subarray(offset).toString() });
            break;
          }
          const streamType = chunk[offset];
          const size = chunk.readUInt32BE(offset + 4);
          offset += 8;
          const data = chunk.subarray(offset, offset + size).toString();
          offset += size;
          events.push({
            type: streamType === 2 ? "stderr" : "stdout",
            data,
          });
        }
      });

      let timer: ReturnType<typeof setTimeout> | undefined;
      if (effectiveTimeout) {
        timer = setTimeout(async () => {
          try {
            await container.kill();
          } catch {
            /* ignore */
          }
        }, effectiveTimeout);
      }

      const exitPromise = container
        .wait()
        .then((result: { StatusCode: number }) => result.StatusCode);

      while (!done) {
        while (events.length > 0) {
          yield events.shift()!;
        }
        const raceResult = await Promise.race([
          exitPromise.then((code) => ({ type: "exit" as const, code })),
          new Promise<null>((r) => setTimeout(() => r(null), 10)),
        ]);
        if (raceResult && raceResult.type === "exit") {
          await new Promise((r) => setTimeout(r, 50));
          while (events.length > 0) {
            yield events.shift()!;
          }
          if (timer) clearTimeout(timer);
          yield { type: "exit", code: raceResult.code };
          done = true;
        }
      }

      // Clean up
      try {
        await container.remove({ force: true });
        const idx = activeContainers.indexOf(container);
        if (idx >= 0) activeContainers.splice(idx, 1);
      } catch {
        /* ignore */
      }
    },

    async cleanup() {
      for (const container of activeContainers) {
        try {
          await container.stop({ t: 2 });
          await container.remove({ force: true });
        } catch {
          /* ignore */
        }
      }
      activeContainers.length = 0;
    },
  };
}
