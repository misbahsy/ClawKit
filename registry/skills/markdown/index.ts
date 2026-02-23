import type { SkillsManager, SkillsConfig, LoadedSkill, PromptSection, Tool, MCPConnection } from "clawkit:types";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";

export interface MarkdownSkillsConfig {
  directories?: string[];
}

interface SkillFrontmatter {
  name?: string;
  description?: string;
  requires?: { bins?: string[]; env?: string[] };
}

function parseFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const yamlBlock = match[1];
  const body = match[2].trim();
  const frontmatter: SkillFrontmatter = {};

  for (const line of yamlBlock.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    if (key === "name") frontmatter.name = value;
    else if (key === "description") frontmatter.description = value;
    else if (key === "requires") {
      // Simple parsing: requires: bins=[qmd], env=[QMD_PATH]
      try {
        const binsMatch = value.match(/bins=\[([^\]]*)\]/);
        const envMatch = value.match(/env=\[([^\]]*)\]/);
        frontmatter.requires = {
          bins: binsMatch ? binsMatch[1].split(",").map(s => s.trim()).filter(Boolean) : undefined,
          env: envMatch ? envMatch[1].split(",").map(s => s.trim()).filter(Boolean) : undefined,
        };
      } catch { /* ignore parse errors */ }
    }
  }

  return { frontmatter, body };
}

export default function createMarkdownSkills(config: MarkdownSkillsConfig): SkillsManager {
  const directories = config.directories ?? ["./workspace/skills"];
  const skills: LoadedSkill[] = [];

  function scanDirectory(dir: string): LoadedSkill[] {
    const found: LoadedSkill[] = [];
    const absDir = resolve(dir);
    if (!existsSync(absDir)) return found;

    const files = readdirSync(absDir).filter(f => f.endsWith(".md"));

    for (const file of files) {
      const filePath = resolve(absDir, file);
      const content = readFileSync(filePath, "utf-8");
      const { frontmatter, body } = parseFrontmatter(content);

      const skillName = frontmatter.name ?? basename(file, ".md");

      found.push({
        name: skillName,
        type: "markdown",
        promptSection: body,
        requirements: frontmatter.requires,
      });
    }

    return found;
  }

  return {
    name: "skills-markdown",

    async loadSkills(_config: SkillsConfig): Promise<LoadedSkill[]> {
      skills.length = 0;

      for (const dir of directories) {
        const found = scanDirectory(dir);
        skills.push(...found);
      }

      return skills;
    },

    getPromptSections(): PromptSection[] {
      return skills
        .filter(s => s.promptSection)
        .map(s => ({
          name: s.name,
          content: s.promptSection!,
        }));
    },

    getTools(): Tool[] {
      return [];
    },

    getMCPConnections(): MCPConnection[] {
      return [];
    },

    async install(_source: string): Promise<void> {
      // Markdown skills are file-based, install is a no-op
    },
  };
}
