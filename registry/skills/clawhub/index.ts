import type { SkillsManager, SkillsConfig, LoadedSkill, PromptSection, Tool, MCPConnection } from "clawkit:types";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { resolve, basename } from "node:path";
import { execSync } from "node:child_process";

export interface ClawHubSkillsConfig {
  skillsDir?: string;
  registryUrl?: string;
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
  }

  return { frontmatter, body };
}

function checkRequirements(requires?: { bins?: string[]; env?: string[] }): string[] {
  const missing: string[] = [];
  if (!requires) return missing;

  if (requires.bins) {
    for (const bin of requires.bins) {
      try {
        execSync(`which ${bin}`, { stdio: "ignore" });
      } catch {
        missing.push(`binary: ${bin}`);
      }
    }
  }

  if (requires.env) {
    for (const envVar of requires.env) {
      if (!process.env[envVar]) {
        missing.push(`env: ${envVar}`);
      }
    }
  }

  return missing;
}

export default function createClawHubSkills(config: ClawHubSkillsConfig): SkillsManager {
  const skillsDir = config.skillsDir ?? "./workspace/skills";
  const registryUrl = config.registryUrl ?? "https://clawhub.dev/api/v1";
  const skills: LoadedSkill[] = [];

  function loadLocalSkills(): LoadedSkill[] {
    const found: LoadedSkill[] = [];
    const absDir = resolve(skillsDir);
    if (!existsSync(absDir)) return found;

    const files = readdirSync(absDir).filter(f => f.endsWith(".md"));

    for (const file of files) {
      const filePath = resolve(absDir, file);
      const content = readFileSync(filePath, "utf-8");
      const { frontmatter, body } = parseFrontmatter(content);

      found.push({
        name: frontmatter.name ?? basename(file, ".md"),
        type: "markdown",
        promptSection: body,
        requirements: frontmatter.requires,
      });
    }

    return found;
  }

  return {
    name: "skills-clawhub",

    async loadSkills(_config: SkillsConfig): Promise<LoadedSkill[]> {
      skills.length = 0;
      skills.push(...loadLocalSkills());
      return skills;
    },

    getPromptSections(): PromptSection[] {
      return skills
        .filter(s => s.promptSection)
        .map(s => ({ name: s.name, content: s.promptSection! }));
    },

    getTools(): Tool[] {
      return [];
    },

    getMCPConnections(): MCPConnection[] {
      return [];
    },

    async install(source: string): Promise<void> {
      const absDir = resolve(skillsDir);
      mkdirSync(absDir, { recursive: true });

      // Fetch skill from ClawHub registry
      const url = `${registryUrl}/skills/${encodeURIComponent(source)}`;
      const res = await fetch(url);

      if (!res.ok) {
        throw new Error(`Failed to fetch skill "${source}" from ClawHub: ${res.status} ${res.statusText}`);
      }

      const data = await res.json() as { name: string; content: string; requires?: { bins?: string[]; env?: string[] } };

      // Check requirements
      const missing = checkRequirements(data.requires);
      if (missing.length > 0) {
        console.warn(`Skill "${source}" has unmet requirements: ${missing.join(", ")}`);
      }

      // Save skill file
      const filename = `${data.name ?? source}.md`;
      writeFileSync(resolve(absDir, filename), data.content, "utf-8");
      console.log(`Installed skill "${source}" to ${resolve(absDir, filename)}`);
    },
  };
}
