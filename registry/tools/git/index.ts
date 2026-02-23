import type { Tool, ToolContext, ToolResult } from "clawkit:types";
import { spawn } from "node:child_process";

export interface GitToolConfig {
  workspaceDir?: string;
  timeout?: number;
}

function runGit(args: string[], cwd: string, timeout: number): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let killed = false;

    const child = spawn("git", args, { cwd, env: { ...process.env } });

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      resolve({ stdout: "", stderr: err.message, code: 1 });
    });

    child.on("close", (code) => {
      if (killed) return;
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? 1 });
    });

    setTimeout(() => {
      if (!child.killed) {
        killed = true;
        child.kill("SIGTERM");
        resolve({ stdout: stdout.trim(), stderr: "Command timed out", code: 1 });
      }
    }, timeout);
  });
}

export default function createGitTool(config: GitToolConfig): Tool {
  const timeout = config.timeout ?? 30000;

  return {
    name: "git",
    description: "Run git operations: status, diff, commit, push, log, add, checkout, branch.",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["status", "diff", "commit", "push", "log", "add", "checkout", "branch"],
          description: "Git operation to perform",
        },
        message: {
          type: "string",
          description: "Commit message (used with commit operation)",
        },
        args: {
          type: "string",
          description: "Additional arguments to pass to the git command",
        },
      },
      required: ["operation"],
    },

    async execute(args: { operation: string; message?: string; args?: string }, context: ToolContext): Promise<ToolResult> {
      const cwd = context.workspaceDir || config.workspaceDir || process.cwd();
      const gitArgs: string[] = [args.operation];

      switch (args.operation) {
        case "commit":
          if (!args.message) {
            return { output: "", error: "Commit requires a message" };
          }
          gitArgs.push("-m", args.message);
          break;
        case "log":
          gitArgs.push("--oneline", "-20");
          break;
        case "diff":
          // default: show staged + unstaged
          break;
      }

      if (args.args) {
        gitArgs.push(...args.args.split(/\s+/));
      }

      try {
        const result = await runGit(gitArgs, cwd, timeout);
        const output = result.stdout + (result.stderr ? `\n${result.stderr}` : "");

        if (result.code !== 0) {
          return { output: output.trim(), error: `git ${args.operation} exited with code ${result.code}` };
        }

        return { output: output.trim() || `git ${args.operation} completed successfully` };
      } catch (err: any) {
        return { output: "", error: err.message };
      }
    },
  };
}
