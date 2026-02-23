import type { Tool, ToolContext, ToolResult } from "clawkit:types";
import { readFile } from "node:fs/promises";
import { resolve, relative } from "node:path";

export interface FileReadToolConfig {
  workspaceDir?: string;
}

export default function createFileReadTool(config: FileReadToolConfig): Tool {
  function safePath(filePath: string, workspaceDir: string): string {
    const resolved = resolve(workspaceDir, filePath);
    const rel = relative(workspaceDir, resolved);
    if (rel.startsWith("..") || resolve(resolved) !== resolved && rel.startsWith("..")) {
      throw new Error(`Path traversal denied: ${filePath}`);
    }
    return resolved;
  }

  return {
    name: "file_read",
    description: "Read the contents of a file. Supports optional line range selection.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to workspace",
        },
        startLine: {
          type: "number",
          description: "Start line (1-based, optional)",
        },
        endLine: {
          type: "number",
          description: "End line (1-based, optional)",
        },
      },
      required: ["path"],
    },

    async execute(args: { path: string; startLine?: number; endLine?: number }, context: ToolContext): Promise<ToolResult> {
      const workspaceDir = context.workspaceDir || config.workspaceDir || process.cwd();

      try {
        const fullPath = safePath(args.path, workspaceDir);
        const content = await readFile(fullPath, "utf-8");

        if (args.startLine || args.endLine) {
          const lines = content.split("\n");
          const start = (args.startLine ?? 1) - 1;
          const end = args.endLine ?? lines.length;
          return { output: lines.slice(start, end).join("\n") };
        }

        return { output: content };
      } catch (err: any) {
        return { output: "", error: err.message };
      }
    },
  };
}
