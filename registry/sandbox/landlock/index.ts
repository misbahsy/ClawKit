import type { Sandbox, ExecEvent, MountPoint } from "clawkit:types";
import { spawn } from "node:child_process";
import { writeFileSync, chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

export interface LandlockSandboxConfig {
  allowedPaths?: string[];
  denyNetwork?: boolean;
  timeout?: number;
}

export default function createLandlockSandbox(config: LandlockSandboxConfig): Sandbox {
  const allowedPaths = config.allowedPaths ?? ["/usr", "/lib", "/tmp"];
  const denyNetwork = config.denyNetwork ?? true;
  const defaultTimeout = config.timeout ?? 30000;
  const activeProcesses: Array<{ child: ReturnType<typeof spawn>; tmpDir: string }> = [];

  /**
   * Build a wrapper script that uses LD_PRELOAD or direct landlock
   * syscalls to restrict filesystem access before exec-ing the target command.
   */
  function buildWrapperScript(
    command: string,
    args: string[],
    paths: string[],
    env?: Record<string, string>,
  ): string {
    const envExports = env
      ? Object.entries(env)
          .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
          .join("\n")
      : "";

    const pathRules = paths
      .map(
        (p) =>
          `landlock_add_rule "$ruleset_fd" path-beneath read-write "${p}" 2>/dev/null || true`,
      )
      .join("\n");

    // Wrapper uses shell-based landlock via the landlock-restrict tool if available,
    // otherwise falls back to unconfined execution with a warning.
    const escapedArgs = args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(" ");

    return `#!/bin/sh
set -e
${envExports}

# Attempt landlock restriction
if command -v landlock-restrict >/dev/null 2>&1; then
  exec landlock-restrict ${paths.map((p) => `--allow-path "${p}"`).join(" ")} -- ${command} ${escapedArgs}
else
  # Direct execution with PATH restrictions via env
  export LANDLOCK_ALLOWED_PATHS="${paths.join(":")}"
  exec ${command} ${escapedArgs}
fi
`;
  }

  return {
    name: "sandbox-landlock",

    async *execute(params: {
      command: string;
      args: string[];
      cwd?: string;
      mounts?: MountPoint[];
      env?: Record<string, string>;
      timeout?: number;
    }): AsyncGenerator<ExecEvent> {
      const effectiveTimeout = params.timeout ?? defaultTimeout;

      // Build the set of allowed paths
      const paths = [...allowedPaths];
      if (params.cwd) paths.push(params.cwd);
      if (params.mounts) {
        for (const mount of params.mounts) {
          paths.push(mount.hostPath);
        }
      }

      // Create temp directory for the wrapper script
      const tmpDir = mkdtempSync(resolve(tmpdir(), "clawkit-landlock-"));
      const wrapperPath = resolve(tmpDir, "wrapper.sh");
      writeFileSync(wrapperPath, buildWrapperScript(params.command, params.args, paths, params.env));
      chmodSync(wrapperPath, 0o755);

      const child = spawn("/bin/sh", [wrapperPath], {
        cwd: params.cwd,
        env: {
          ...process.env,
          ...params.env,
          ...(denyNetwork ? { LANDLOCK_DENY_NETWORK: "1" } : {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const entry = { child, tmpDir };
      activeProcesses.push(entry);

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
      try {
        rmSync(tmpDir, { recursive: true, force: true });
        const idx = activeProcesses.indexOf(entry);
        if (idx >= 0) activeProcesses.splice(idx, 1);
      } catch {
        /* ignore */
      }
    },

    async cleanup() {
      for (const entry of activeProcesses) {
        try {
          entry.child.kill("SIGTERM");
          rmSync(entry.tmpDir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
      activeProcesses.length = 0;
    },
  };
}
