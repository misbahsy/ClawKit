import type { Tool, ToolContext, ToolResult } from "clawkit:types";
import { spawnSync } from "node:child_process";

export interface QmdSearchToolConfig {
  qmdPath?: string;
  timeout?: number;
}

export default function createQmdSearchTool(config: QmdSearchToolConfig): Tool {
  const qmdPath = config.qmdPath ?? "qmd";
  const timeout = config.timeout ?? 30000;

  return {
    name: "qmd_search",
    description:
      "Search QMD document collections using natural language queries. Uses the QMD CLI for semantic search across indexed documents.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language search query",
        },
        collection: {
          type: "string",
          description: "QMD collection name to search within (optional, searches all if omitted)",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return",
        },
      },
      required: ["query"],
    },

    async execute(
      args: { query: string; collection?: string; limit?: number },
      _context: ToolContext,
    ): Promise<ToolResult> {
      try {
        const cmdArgs = ["query", args.query];

        if (args.collection) {
          cmdArgs.push("--collection", args.collection);
        }

        if (args.limit) {
          cmdArgs.push("--limit", String(args.limit));
        }

        const result = spawnSync(qmdPath, cmdArgs, {
          timeout,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        });

        if (result.error) {
          if ((result.error as any).code === "ENOENT") {
            return {
              output: "",
              error: `QMD CLI not found at "${qmdPath}". Install it or set qmdPath in config.`,
            };
          }
          return { output: "", error: result.error.message };
        }

        if (result.status !== 0) {
          const stderr = result.stderr?.trim() ?? "";
          return { output: "", error: `QMD exited with code ${result.status}: ${stderr}` };
        }

        const output = result.stdout?.trim() ?? "";
        if (!output) {
          return { output: "No results found." };
        }

        return {
          output,
          metadata: {
            collection: args.collection ?? "all",
            query: args.query,
          },
        };
      } catch (err: any) {
        return { output: "", error: err.message };
      }
    },
  };
}
