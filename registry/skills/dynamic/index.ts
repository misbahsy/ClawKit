import type {
  SkillsManager, SkillsConfig, LoadedSkill, PromptSection,
  Tool, ToolResult, ToolContext, MCPConnection,
} from "clawkit:types";

export interface DynamicSkillsConfig {
  sandboxed?: boolean;
  maxDynamicTools?: number;
  scriptDir?: string;
}

export default function createDynamicSkills(config: DynamicSkillsConfig): SkillsManager {
  const maxDynamicTools = config.maxDynamicTools ?? 20;
  const scriptDir = config.scriptDir ?? "./workspace/dynamic-tools";
  const sandboxed = config.sandboxed ?? true;
  const dynamicTools: Tool[] = [];
  const skills: LoadedSkill[] = [];

  function createDynamicTool(name: string, description: string, script: string): Tool {
    return {
      name: `dynamic__${name}`,
      description,
      parameters: {
        type: "object",
        properties: { input: { type: "string", description: "Input to the dynamic tool" } },
      },
      async execute(args: Record<string, any>, context: ToolContext): Promise<ToolResult> {
        if (sandboxed && context.sandbox) {
          const events: string[] = [];
          for await (const event of context.sandbox.execute({
            command: "node",
            args: ["-e", script.replace("__INPUT__", args.input ?? "")],
            cwd: context.workspaceDir,
            timeout: 10000,
          })) {
            if (event.type === "stdout") events.push(event.data);
            if (event.type === "stderr") events.push(`[stderr] ${event.data}`);
          }
          return { output: events.join("") };
        }
        // Non-sandboxed: use child_process
        const { execSync } = await import("node:child_process");
        try {
          const result = execSync(`node -e '${script.replace("__INPUT__", args.input ?? "")}'`, {
            encoding: "utf-8",
            timeout: 10000,
            cwd: context.workspaceDir,
          });
          return { output: result };
        } catch (err: any) {
          return { output: "", error: err.message };
        }
      },
    };
  }

  return {
    name: "skills-dynamic",

    async loadSkills(_config: SkillsConfig): Promise<LoadedSkill[]> {
      skills.length = 0;

      // Load any pre-existing dynamic tools from scriptDir
      const { existsSync, readdirSync, readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const dir = resolve(scriptDir);
      if (existsSync(dir)) {
        const files = readdirSync(dir).filter(f => f.endsWith(".json"));
        for (const file of files) {
          try {
            const data = JSON.parse(readFileSync(resolve(dir, file), "utf-8"));
            if (data.name && data.script) {
              const tool = createDynamicTool(data.name, data.description ?? "", data.script);
              dynamicTools.push(tool);
            }
          } catch { /* skip invalid */ }
        }
      }

      skills.push({
        name: "dynamic-tools",
        type: "tool-bundle",
        tools: dynamicTools,
        promptSection: dynamicTools.length > 0
          ? `Dynamic tools available: ${dynamicTools.map(t => t.name).join(", ")}`
          : undefined,
      });

      return skills;
    },

    getPromptSections(): PromptSection[] {
      return skills.filter(s => s.promptSection).map(s => ({ name: s.name, content: s.promptSection! }));
    },

    getTools(): Tool[] {
      return dynamicTools;
    },

    getMCPConnections(): MCPConnection[] {
      return [];
    },

    async install(source: string): Promise<void> {
      if (dynamicTools.length >= maxDynamicTools) {
        throw new Error(`Maximum dynamic tools (${maxDynamicTools}) reached`);
      }

      // Parse source as JSON: { name, description, script }
      const data = JSON.parse(source);
      const tool = createDynamicTool(data.name, data.description ?? "", data.script);
      dynamicTools.push(tool);

      // Persist to scriptDir
      const { mkdirSync, writeFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      mkdirSync(resolve(scriptDir), { recursive: true });
      writeFileSync(resolve(scriptDir, `${data.name}.json`), JSON.stringify(data), "utf-8");
    },
  };
}
