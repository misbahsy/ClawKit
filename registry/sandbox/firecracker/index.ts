import type { Sandbox, ExecEvent, MountPoint } from "clawkit:types";
import { spawn, ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

export interface FirecrackerSandboxConfig {
  firecrackerPath?: string;
  kernelPath?: string;
  rootfsPath?: string;
  memoryMb?: number;
  vcpuCount?: number;
  timeout?: number;
}

export default function createFirecrackerSandbox(config: FirecrackerSandboxConfig): Sandbox {
  const firecrackerPath = config.firecrackerPath ?? "/usr/bin/firecracker";
  const kernelPath = config.kernelPath ?? "./vmlinux";
  const rootfsPath = config.rootfsPath ?? "./rootfs.ext4";
  const memoryMb = config.memoryMb ?? 256;
  const vcpuCount = config.vcpuCount ?? 1;
  const defaultTimeout = config.timeout ?? 30000;
  const activeVMs: Array<{ proc: ChildProcess; socketPath: string; tmpDir: string }> = [];

  async function firecrackerAPI(
    socketPath: string,
    method: string,
    path: string,
    body?: object,
  ): Promise<any> {
    // Use fetch with unix socket via the Firecracker REST API
    const url = `http://localhost${path}`;
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        // @ts-ignore - unix socket support
        unix: socketPath,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Firecracker API ${method} ${path}: ${res.status} ${text}`);
      }
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    } catch (err: any) {
      throw new Error(`Firecracker API error: ${err.message}`);
    }
  }

  return {
    name: "sandbox-firecracker",

    async *execute(params: {
      command: string;
      args: string[];
      cwd?: string;
      mounts?: MountPoint[];
      env?: Record<string, string>;
      timeout?: number;
    }): AsyncGenerator<ExecEvent> {
      const effectiveTimeout = params.timeout ?? defaultTimeout;
      const tmpDir = mkdtempSync(resolve(tmpdir(), "clawkit-fc-"));
      const socketPath = resolve(tmpDir, "firecracker.sock");

      // Write the command to a script that the VM will execute
      const cmdScript = [params.command, ...params.args].join(" ");
      writeFileSync(resolve(tmpDir, "cmd.sh"), cmdScript, { mode: 0o755 });

      // Start Firecracker process
      const proc = spawn(
        firecrackerPath,
        ["--api-sock", socketPath, "--level", "Warning"],
        {
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      const vm = { proc, socketPath, tmpDir };
      activeVMs.push(vm);

      // Wait briefly for socket to be ready
      await new Promise((r) => setTimeout(r, 200));

      // Configure the VM via API
      try {
        await firecrackerAPI(socketPath, "PUT", "/machine-config", {
          vcpu_count: vcpuCount,
          mem_size_mib: memoryMb,
        });

        await firecrackerAPI(socketPath, "PUT", "/boot-source", {
          kernel_image_path: kernelPath,
          boot_args: "console=ttyS0 reboot=k panic=1 pci=off",
        });

        await firecrackerAPI(socketPath, "PUT", "/drives/rootfs", {
          drive_id: "rootfs",
          path_on_host: rootfsPath,
          is_root_device: true,
          is_read_only: false,
        });

        // Start the instance
        await firecrackerAPI(socketPath, "PUT", "/actions", {
          action_type: "InstanceStart",
        });
      } catch (err: any) {
        yield { type: "stderr", data: `Failed to configure Firecracker VM: ${err.message}` };
        yield { type: "exit", code: 1 };
        proc.kill("SIGTERM");
        return;
      }

      const events: ExecEvent[] = [];
      let done = false;

      proc.stdout!.on("data", (data: Buffer) => {
        events.push({ type: "stdout", data: data.toString() });
      });

      proc.stderr!.on("data", (data: Buffer) => {
        events.push({ type: "stderr", data: data.toString() });
      });

      let timer: ReturnType<typeof setTimeout> | undefined;
      if (effectiveTimeout) {
        timer = setTimeout(() => {
          proc.kill("SIGTERM");
        }, effectiveTimeout);
      }

      const exitPromise = new Promise<number>((resolve) => {
        proc.on("close", (code) => resolve(code ?? 1));
        proc.on("error", () => resolve(1));
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
      try {
        proc.kill("SIGTERM");
        rmSync(tmpDir, { recursive: true, force: true });
        const idx = activeVMs.indexOf(vm);
        if (idx >= 0) activeVMs.splice(idx, 1);
      } catch {
        /* ignore */
      }
    },

    async cleanup() {
      for (const vm of activeVMs) {
        try {
          vm.proc.kill("SIGTERM");
          rmSync(vm.tmpDir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
      activeVMs.length = 0;
    },
  };
}
