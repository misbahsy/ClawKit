import type { PromptBuilder, PromptContext } from "clawkit:types";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

export interface WorkspacePromptConfig {
  workspaceDir?: string;
}

interface CachedFile {
  content: string;
  mtime: number;
}

const WORKSPACE_FILES = ["AGENTS.md", "SOUL.md", "TOOLS.md", "USER.md"] as const;

export default function createWorkspacePrompt(config: WorkspacePromptConfig): PromptBuilder {
  const workspaceDir = config.workspaceDir ?? "./workspace";
  const cache = new Map<string, CachedFile>();

  function readCached(filename: string): string | null {
    const filePath = resolve(workspaceDir, filename);
    try {
      const stat = statSync(filePath);
      const mtime = stat.mtimeMs;
      const cached = cache.get(filename);

      if (cached && cached.mtime === mtime) {
        return cached.content;
      }

      const content = readFileSync(filePath, "utf-8").trim();
      cache.set(filename, { content, mtime });
      return content;
    } catch {
      return null;
    }
  }

  return {
    name: "prompt-workspace",

    async build(context: PromptContext): Promise<string> {
      const sections: string[] = [];

      // Load workspace files
      const agentsContent = readCached("AGENTS.md");
      const soulContent = readCached("SOUL.md");
      const toolsContent = readCached("TOOLS.md");
      const userContent = readCached("USER.md");

      // Identity from AGENTS.md or fallback
      if (agentsContent) {
        sections.push(agentsContent);
      } else {
        const agentName = context.agent.name ?? "Assistant";
        sections.push(`You are ${agentName}, a helpful AI assistant.`);
      }

      // Personality from SOUL.md
      if (soulContent) {
        sections.push(soulContent);
      }

      // Tool instructions from TOOLS.md
      if (toolsContent) {
        sections.push(toolsContent);
      }

      // User preferences from USER.md
      if (userContent) {
        sections.push(userContent);
      }

      // Runtime context
      sections.push(`Current date and time: ${context.dateTime}`);
      sections.push(`Timezone: ${context.timezone}`);

      if (context.channel) {
        sections.push(`Channel: ${context.channel} (${context.sessionType})`);
      }

      if (context.user?.name) {
        sections.push(`User: ${context.user.name}`);
      }

      // Available tools
      if (context.tools.length > 0) {
        const toolList = context.tools
          .map((t) => `- ${t.name}: ${t.description}`)
          .join("\n");
        sections.push(`\nAvailable tools:\n${toolList}`);
      }

      // Memory context
      if (context.memoryContext) {
        sections.push(`\nRelevant context from memory:\n${context.memoryContext}`);
      }

      // Skills
      if (context.skills.length > 0) {
        for (const skill of context.skills) {
          if (skill.promptSection) {
            sections.push(`\n${skill.promptSection}`);
          }
        }
      }

      return sections.join("\n\n");
    },
  };
}
