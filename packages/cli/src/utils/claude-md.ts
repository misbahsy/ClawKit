import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import { readComponentMeta, getInstalledComponents, type ComponentMeta } from "./registry.js";

const CATEGORY_LABELS: Record<string, string> = {
  channels: "Channel",
  agents: "Runtime",
  memory: "Memory",
  queue: "Queue",
  sandbox: "Sandbox",
  prompt: "Prompt",
  tools: "Tools",
  scheduler: "Scheduler",
  skills: "Skills",
  ipc: "IPC",
};

export function generateClaudeMd(name: string, components: ComponentMeta[]): string {
  const architecture: string[] = [];
  const toolNames: string[] = [];

  for (const comp of components) {
    if (comp.category === "tools") {
      toolNames.push(comp.name.replace("tool-", ""));
      continue;
    }
    const label = CATEGORY_LABELS[comp.category] ?? comp.category;
    architecture.push(`- **${label}:** ${comp.description}`);
  }

  const channelName = components.find((c) => c.category === "channels")?.name ?? "input";
  const queueName = components.find((c) => c.category === "queue")?.name ?? "queue";
  const promptName = components.find((c) => c.category === "prompt")?.name ?? "prompt";
  const agentName = components.find((c) => c.category === "agents")?.name ?? "agent";

  const messageFlow = `${channelName} -> ${queueName} -> ${promptName} -> ${agentName} -> tools -> response -> ${channelName}`;

  const sections: string[] = [];
  sections.push(`# Agent: ${name}`);
  sections.push("");
  sections.push("Built with [ClawKit](https://github.com/menloparklab/clawkit).");
  sections.push("");
  sections.push("## Architecture");
  sections.push("");
  sections.push(architecture.join("\n"));
  sections.push("");

  if (toolNames.length > 0) {
    sections.push("## Tools");
    sections.push("");
    sections.push(toolNames.join(", "));
    sections.push("");
  }

  sections.push("## Message Flow");
  sections.push("");
  sections.push(messageFlow);
  sections.push("");
  sections.push("## Key Files");
  sections.push("");
  sections.push("- `clawkit.config.ts` — All component configuration");
  sections.push("- `workspace/AGENTS.md` — Agent identity and instructions");
  sections.push("- `workspace/SOUL.md` — Personality and values");
  sections.push("- `components/` — All component source code (editable)");
  sections.push("");
  sections.push("## Running");
  sections.push("");
  sections.push("```");
  sections.push("npm start");
  sections.push("```");
  sections.push("");
  sections.push("## Common Tasks");
  sections.push("");
  sections.push("- Change model: edit `agent.model` in clawkit.config.ts");
  sections.push("- Add a channel: `npx clawkit add telegram`");
  sections.push("- Add a tool: `npx clawkit add tool-git`");
  sections.push("- View installed: `npx clawkit status`");
  sections.push("");
  sections.push("<!-- USER NOTES -->");
  sections.push("<!-- Add your notes below this line — they survive `clawkit add`/`clawkit remove` -->");
  sections.push("");

  return sections.join("\n");
}

export function preserveUserNotes(existingContent: string, newContent: string): string {
  const marker = "<!-- USER NOTES -->";
  const existingMarkerIdx = existingContent.indexOf(marker);
  if (existingMarkerIdx === -1) return newContent;

  const userNotes = existingContent.slice(existingMarkerIdx);
  const newMarkerIdx = newContent.indexOf(marker);
  if (newMarkerIdx === -1) return newContent + "\n" + userNotes;

  return newContent.slice(0, newMarkerIdx) + userNotes;
}

export function validateProjectDir(projectDir: string): void {
  if (!existsSync(resolve(projectDir, "clawkit.config.ts"))) {
    console.error(chalk.red("Not a ClawKit project. Run `clawkit init` first."));
    process.exit(1);
  }
}

export function regenerateClaudeMd(projectDir: string): void {
  const configPath = resolve(projectDir, "clawkit.config.ts");
  if (!existsSync(configPath)) return;

  const installed = getInstalledComponents(projectDir);
  const metas: ComponentMeta[] = [];
  for (const name of installed) {
    try {
      metas.push(readComponentMeta(name));
    } catch { /* skip unknown */ }
  }

  const claudeMdPath = resolve(projectDir, "CLAUDE.md");
  const existingContent = existsSync(claudeMdPath) ? readFileSync(claudeMdPath, "utf-8") : "";

  const configContent = readFileSync(configPath, "utf-8");
  const nameMatch = configContent.match(/name:\s*["']([^"']+)["']/);
  const projectName = nameMatch?.[1] ?? "agent";

  let newContent = generateClaudeMd(projectName, metas);
  if (existingContent) {
    newContent = preserveUserNotes(existingContent, newContent);
  }
  writeFileSync(claudeMdPath, newContent, "utf-8");
}
