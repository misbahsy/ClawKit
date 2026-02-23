import type { Tool, ToolContext, ToolResult } from "clawkit:types";
import { spawn } from "node:child_process";

export interface BashToolConfig {
  workspaceDir?: string;
  timeout?: number;
}

export default function createBashTool(config: BashToolConfig): Tool {
  const timeout = config.timeout ?? 30000;

  return {
    name: "bash",
    description: "Execute a shell command and return the output. Use for running scripts, installing packages, or any terminal operation.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
        },
      },
      required: ["command"],
    },

    async execute(args: { command: string }, context: ToolContext): Promise<ToolResult> {
      const cwd = context.workspaceDir || config.workspaceDir || process.cwd();

      return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";
        let killed = false;

        const child = spawn("sh", ["-c", args.command], {
          cwd,
          env: { ...process.env },
          timeout,
        });

        child.stdout.on("data", (data: Buffer) => {
          stdout += data.toString();
        });

        child.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        child.on("error", (err) => {
          resolve({ output: "", error: err.message });
        });

        child.on("close", (code) => {
          const output = (stdout + (stderr ? `\nSTDERR:\n${stderr}` : "")).trim();
          if (code !== 0 && !killed) {
            resolve({ output, error: `Process exited with code ${code}` });
          } else {
            resolve({ output });
          }
        });

        setTimeout(() => {
          if (!child.killed) {
            killed = true;
            child.kill("SIGTERM");
            resolve({ output: stdout.trim(), error: `Command timed out after ${timeout}ms` });
          }
        }, timeout);
      });
    },
  };
}
