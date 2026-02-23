import type {
  SkillsManager,
  SkillsConfig,
  LoadedSkill,
  PromptSection,
  Tool,
  ToolResult,
  ToolContext,
  MCPConnection,
} from "clawkit:types";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

export interface ToolBundleConfig {
  name?: string;
  directories?: string[];
}

interface BundleJson {
  name: string;
  description?: string;
  promptSection?: string;
  tools?: BundleTool[];
}

interface BundleTool {
  name: string;
  description: string;
  parameters?: Record<string, any>;
}

export default function createToolBundleSkills(config: ToolBundleConfig): SkillsManager {
  const loadedSkills: LoadedSkill[] = [];
  const allTools: Tool[] = [];

  function scanDirectory(dir: string): BundleJson[] {
    const bundles: BundleJson[] = [];
    const resolved = resolve(dir);

    if (!existsSync(resolved)) return bundles;

    try {
      const stat = statSync(resolved);
      if (!stat.isDirectory()) return bundles;
    } catch {
      return bundles;
    }

    const files = readdirSync(resolved).filter((f) => f.endsWith(".json"));

    for (const file of files) {
      try {
        const content = readFileSync(join(resolved, file), "utf-8");
        const bundle: BundleJson = JSON.parse(content);

        if (!bundle.name) {
          bundle.name = file.replace(/\.json$/, "");
        }

        bundles.push(bundle);
      } catch {
        // Skip malformed bundles
      }
    }

    return bundles;
  }

  function bundleToolToTool(bundleName: string, bt: BundleTool): Tool {
    return {
      name: `${bundleName}__${bt.name}`,
      description: bt.description,
      parameters: bt.parameters ?? {},
      async execute(_args: Record<string, any>, _context: ToolContext): Promise<ToolResult> {
        return {
          output: "",
          error: `Tool "${bt.name}" from bundle "${bundleName}" has no runtime implementation. Bundle tools are declarative only.`,
        };
      },
    };
  }

  return {
    name: "skills-tool-bundle",

    async loadSkills(skillsConfig: SkillsConfig): Promise<LoadedSkill[]> {
      loadedSkills.length = 0;
      allTools.length = 0;

      const directories = config.directories ?? [];

      for (const dir of directories) {
        const bundles = scanDirectory(dir);

        for (const bundle of bundles) {
          const tools: Tool[] = (bundle.tools ?? []).map((bt) =>
            bundleToolToTool(bundle.name, bt),
          );

          allTools.push(...tools);

          loadedSkills.push({
            name: bundle.name,
            type: "tool-bundle",
            promptSection: bundle.promptSection ?? bundle.description,
            tools,
          });
        }
      }

      return loadedSkills;
    },

    getPromptSections(): PromptSection[] {
      return loadedSkills
        .filter((s) => s.promptSection)
        .map((s) => ({
          name: s.name,
          content: s.promptSection!,
        }));
    },

    getTools(): Tool[] {
      return allTools;
    },

    getMCPConnections(): MCPConnection[] {
      return [];
    },

    async install(_source: string): Promise<void> {
      // Tool bundles are loaded from directories, not installed
    },
  };
}
