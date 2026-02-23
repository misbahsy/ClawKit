import type { Sandbox, ExecEvent } from "clawkit:types";
import Docker from "dockerode";

export interface DockerSandboxConfig {
  name?: string;
  image?: string;
  memoryLimit?: number;
  cpuQuota?: number;
  networkAccess?: boolean;
  timeout?: number;
}

export default function createDockerSandbox(config: DockerSandboxConfig): Sandbox {
  const image = config.image ?? "node:20-slim";
  const memoryLimit = config.memoryLimit ?? 512 * 1024 * 1024; // 512MB
  const cpuQuota = config.cpuQuota ?? 100000;
  const networkAccess = config.networkAccess ?? false;
  const defaultTimeout = config.timeout ?? 30000;

  const docker = new Docker();
  const containers: Docker.Container[] = [];

  async function ensureImage(imageName: string): Promise<void> {
    try {
      await docker.getImage(imageName).inspect();
    } catch {
      console.log(`Pulling image ${imageName}...`);
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
    name: "sandbox-docker",

    async *execute(params): AsyncGenerator<ExecEvent> {
      const { command, args, cwd, mounts, env, timeout } = params;
      const effectiveTimeout = timeout ?? defaultTimeout;

      await ensureImage(image);

      const binds: string[] = [];
      if (mounts) {
        for (const mount of mounts) {
          const mode = mount.readonly ? "ro" : "rw";
          binds.push(`${mount.hostPath}:${mount.containerPath}:${mode}`);
        }
      }

      const envArray = env
        ? Object.entries(env).map(([k, v]) => `${k}=${v}`)
        : [];

      const container = await docker.createContainer({
        Image: image,
        Cmd: [command, ...args],
        WorkingDir: cwd ?? "/workspace",
        Env: envArray,
        HostConfig: {
          Memory: memoryLimit,
          CpuQuota: cpuQuota,
          NetworkMode: networkAccess ? "bridge" : "none",
          Binds: binds.length > 0 ? binds : undefined,
        },
        AttachStdout: true,
        AttachStderr: true,
      });

      containers.push(container);

      const stream = await container.attach({ stream: true, stdout: true, stderr: true });
      await container.start();

      const events: ExecEvent[] = [];
      let done = false;

      // Docker multiplexes stdout/stderr in the stream
      // Each frame: [type(1)][padding(3)][size(4)][data(size)]
      stream.on("data", (chunk: Buffer) => {
        let offset = 0;
        while (offset < chunk.length) {
          if (offset + 8 > chunk.length) {
            // Incomplete header, treat rest as stdout
            events.push({ type: "stdout", data: chunk.subarray(offset).toString() });
            break;
          }
          const streamType = chunk[offset]; // 1 = stdout, 2 = stderr
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
          try { await container.kill(); } catch { /* ignore */ }
        }, effectiveTimeout);
      }

      const exitPromise = container.wait().then((result: { StatusCode: number }) => result.StatusCode);

      while (!done) {
        while (events.length > 0) {
          yield events.shift()!;
        }
        const raceResult = await Promise.race([
          exitPromise.then((code) => ({ type: "exit" as const, code })),
          new Promise<null>((r) => setTimeout(() => r(null), 10)),
        ]);
        if (raceResult && raceResult.type === "exit") {
          // Small delay to collect remaining output
          await new Promise((r) => setTimeout(r, 50));
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
        await container.remove({ force: true });
        const idx = containers.indexOf(container);
        if (idx >= 0) containers.splice(idx, 1);
      } catch { /* ignore */ }
    },

    async cleanup() {
      for (const container of containers) {
        try {
          await container.stop({ t: 2 });
          await container.remove({ force: true });
        } catch { /* ignore */ }
      }
      containers.length = 0;
    },
  };
}
