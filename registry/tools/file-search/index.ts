import type { Tool, ToolContext, ToolResult } from "clawkit:types";
import { readdir, stat } from "node:fs/promises";
import { resolve, relative, basename } from "node:path";

export interface FileSearchToolConfig {
  workspaceDir?: string;
  defaultMaxResults?: number;
}

function matchGlob(pattern: string, filePath: string): boolean {
  // Convert glob pattern to regex
  let regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/{{GLOBSTAR}}/g, ".*");
  return new RegExp(`^${regex}$`).test(filePath);
}

async function walkDir(
  dir: string,
  baseDir: string,
  pattern: string | undefined,
  regex: RegExp | undefined,
  maxResults: number,
  results: string[],
): Promise<void> {
  if (results.length >= maxResults) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= maxResults) return;

    const fullPath = resolve(dir, entry.name);
    const relPath = relative(baseDir, fullPath);

    // Skip hidden directories and node_modules
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

    if (entry.isDirectory()) {
      await walkDir(fullPath, baseDir, pattern, regex, maxResults, results);
    } else if (entry.isFile()) {
      const matches = regex
        ? regex.test(relPath) || regex.test(basename(relPath))
        : pattern
          ? matchGlob(pattern, relPath) || matchGlob(pattern, basename(relPath))
          : true;

      if (matches) {
        results.push(relPath);
      }
    }
  }
}

export default function createFileSearchTool(config: FileSearchToolConfig): Tool {
  const defaultMaxResults = config.defaultMaxResults ?? 100;

  return {
    name: "file_search",
    description:
      "Search for files in the workspace using glob patterns or regex. Returns matching file paths.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern (e.g. '**/*.ts') or plain text to match filenames",
        },
        directory: {
          type: "string",
          description: "Subdirectory to search within (relative to workspace)",
        },
        regex: {
          type: "boolean",
          description: "Treat pattern as a regular expression instead of glob",
        },
        maxResults: {
          type: "number",
          description: "Maximum number of results to return",
        },
      },
      required: ["pattern"],
    },

    async execute(
      args: { pattern: string; directory?: string; regex?: boolean; maxResults?: number },
      context: ToolContext,
    ): Promise<ToolResult> {
      const workspaceDir = context.workspaceDir || config.workspaceDir || process.cwd();
      const searchDir = args.directory
        ? resolve(workspaceDir, args.directory)
        : workspaceDir;
      const maxResults = args.maxResults ?? defaultMaxResults;

      // Validate search directory is within workspace
      const rel = relative(workspaceDir, searchDir);
      if (rel.startsWith("..")) {
        return { output: "", error: "Search directory must be within workspace" };
      }

      try {
        const dirStat = await stat(searchDir);
        if (!dirStat.isDirectory()) {
          return { output: "", error: `Not a directory: ${args.directory}` };
        }
      } catch {
        return { output: "", error: `Directory not found: ${args.directory ?? workspaceDir}` };
      }

      let regex: RegExp | undefined;
      let globPattern: string | undefined;

      if (args.regex) {
        try {
          regex = new RegExp(args.pattern, "i");
        } catch (err: any) {
          return { output: "", error: `Invalid regex: ${err.message}` };
        }
      } else {
        globPattern = args.pattern;
      }

      try {
        const results: string[] = [];
        await walkDir(searchDir, workspaceDir, globPattern, regex, maxResults, results);

        if (results.length === 0) {
          return { output: "No files found matching the pattern." };
        }

        const truncated = results.length >= maxResults;
        const output = results.join("\n") + (truncated ? `\n...(limited to ${maxResults} results)` : "");
        return {
          output,
          metadata: { count: results.length, truncated },
        };
      } catch (err: any) {
        return { output: "", error: err.message };
      }
    },
  };
}
