import type { Tool, ToolContext, ToolResult } from "clawkit:types";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";

export interface FileEditToolConfig {
  workspaceDir?: string;
}

export default function createFileEditTool(config: FileEditToolConfig): Tool {
  function safePath(filePath: string, workspaceDir: string): string {
    const resolved = resolve(workspaceDir, filePath);
    const rel = relative(workspaceDir, resolved);
    if (rel.startsWith("..")) {
      throw new Error(`Path traversal denied: ${filePath}`);
    }
    return resolved;
  }

  return {
    name: "file_edit",
    description: "Edit a file by replacing a unique string with new content. The old_string must appear exactly once in the file.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to workspace",
        },
        old_string: {
          type: "string",
          description: "Exact string to find (must be unique in file)",
        },
        new_string: {
          type: "string",
          description: "Replacement string",
        },
      },
      required: ["path", "old_string", "new_string"],
    },

    async execute(args: { path: string; old_string: string; new_string: string }, context: ToolContext): Promise<ToolResult> {
      const workspaceDir = context.workspaceDir || config.workspaceDir || process.cwd();

      try {
        const fullPath = safePath(args.path, workspaceDir);
        const content = await readFile(fullPath, "utf-8");
        const count = content.split(args.old_string).length - 1;

        if (count === 0) {
          return { output: "", error: `String not found in ${args.path}` };
        }
        if (count > 1) {
          return { output: "", error: `String found ${count} times in ${args.path}, must be unique` };
        }

        const newContent = content.replace(args.old_string, args.new_string);
        await writeFile(fullPath, newContent, "utf-8");
        return { output: `Edited ${args.path}: replaced 1 occurrence` };
      } catch (err: any) {
        return { output: "", error: err.message };
      }
    },
  };
}
