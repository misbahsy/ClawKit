import type { Tool, ToolContext, ToolResult } from "clawkit:types";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";

export interface FileWriteToolConfig {
  workspaceDir?: string;
}

export default function createFileWriteTool(config: FileWriteToolConfig): Tool {
  function safePath(filePath: string, workspaceDir: string): string {
    const resolved = resolve(workspaceDir, filePath);
    const rel = relative(workspaceDir, resolved);
    if (rel.startsWith("..")) {
      throw new Error(`Path traversal denied: ${filePath}`);
    }
    return resolved;
  }

  return {
    name: "file_write",
    description: "Write content to a file. Creates parent directories if needed.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to workspace",
        },
        content: {
          type: "string",
          description: "Content to write to the file",
        },
      },
      required: ["path", "content"],
    },

    async execute(args: { path: string; content: string }, context: ToolContext): Promise<ToolResult> {
      const workspaceDir = context.workspaceDir || config.workspaceDir || process.cwd();

      try {
        const fullPath = safePath(args.path, workspaceDir);
        await mkdir(dirname(fullPath), { recursive: true });
        await writeFile(fullPath, args.content, "utf-8");
        return { output: `Written to ${args.path}` };
      } catch (err: any) {
        return { output: "", error: err.message };
      }
    },
  };
}
