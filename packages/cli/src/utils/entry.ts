import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ComponentMeta } from "./registry.js";

const MARKERS = {
  IMPORTS: { start: "// === IMPORTS ===", end: "// === /IMPORTS ===" },
  CHANNELS: { start: "// === CHANNELS ===", end: "// === /CHANNELS ===" },
  AGENT: { start: "// === AGENT ===", end: "// === /AGENT ===" },
  MEMORY: { start: "// === MEMORY ===", end: "// === /MEMORY ===" },
  QUEUE: { start: "// === QUEUE ===", end: "// === /QUEUE ===" },
  PROMPT: { start: "// === PROMPT ===", end: "// === /PROMPT ===" },
  SANDBOX: { start: "// === SANDBOX ===", end: "// === /SANDBOX ===" },
  TOOLS: { start: "// === TOOLS ===", end: "// === /TOOLS ===" },
  SCHEDULER: { start: "// === SCHEDULER ===", end: "// === /SCHEDULER ===" },
  SKILLS: { start: "// === SKILLS ===", end: "// === /SKILLS ===" },
  IPC: { start: "// === IPC ===", end: "// === /IPC ===" },
};

function getImportPath(meta: ComponentMeta, registry: Record<string, { category: string; path: string }>): string {
  const entry = registry[meta.name];
  return `../components/${entry.path}/index.js`;
}

export function generateEntryPoint(components: ComponentMeta[], registry: Record<string, { category: string; path: string }>): string {
  const channels = components.filter((c) => c.category === "channels");
  const agents = components.filter((c) => c.category === "agents");
  const memories = components.filter((c) => c.category === "memory");
  const queues = components.filter((c) => c.category === "queue");
  const prompts = components.filter((c) => c.category === "prompt");
  const sandboxes = components.filter((c) => c.category === "sandbox");
  const tools = components.filter((c) => c.category === "tools");
  const schedulers = components.filter((c) => c.category === "scheduler");
  const skills = components.filter((c) => c.category === "skills");
  const ipcs = components.filter((c) => c.category === "ipc");

  const imports: string[] = [];
  imports.push(`import config from "../clawkit.config.js";`);
  imports.push(`import { startAgent } from "../core/runtime.js";`);

  for (const comp of components) {
    const path = getImportPath(comp, registry);
    imports.push(`import ${comp.importName} from "${path}";`);
  }

  const channelInits = channels
    .map((c) => c.instanceTemplate)
    .join(", ");

  const agent = agents[0];
  const memory = memories[0];
  const queue = queues[0];
  const prompt = prompts[0];
  const sandbox = sandboxes[0];

  const toolInits = tools.map((t) => `  ${t.instanceTemplate}`).join(",\n");

  const scheduler = schedulers[0];
  const skillsMgr = skills[0];
  const ipcComp = ipcs[0];

  return `${MARKERS.IMPORTS.start}
${imports.join("\n")}
${MARKERS.IMPORTS.end}

${MARKERS.CHANNELS.start}
const channels = [${channelInits}];
${MARKERS.CHANNELS.end}

${MARKERS.AGENT.start}
const agent = ${agent ? agent.instanceTemplate : "null /* no agent configured */"};
${MARKERS.AGENT.end}

${MARKERS.MEMORY.start}
const memory = ${memory ? memory.instanceTemplate : "null /* no memory configured */"};
${MARKERS.MEMORY.end}

${MARKERS.QUEUE.start}
const queue = ${queue ? queue.instanceTemplate : "null /* no queue configured */"};
${MARKERS.QUEUE.end}

${MARKERS.PROMPT.start}
const promptBuilder = ${prompt ? prompt.instanceTemplate : "null /* no prompt configured */"};
${MARKERS.PROMPT.end}

${MARKERS.SANDBOX.start}
const sandbox = ${sandbox ? sandbox.instanceTemplate : "undefined"};
${MARKERS.SANDBOX.end}

${MARKERS.TOOLS.start}
const tools = [
${toolInits}
];
${MARKERS.TOOLS.end}

${MARKERS.SCHEDULER.start}
const scheduler = ${scheduler ? scheduler.instanceTemplate : "undefined"};
${MARKERS.SCHEDULER.end}

${MARKERS.SKILLS.start}
const skills = ${skillsMgr ? skillsMgr.instanceTemplate : "undefined"};
${MARKERS.SKILLS.end}

${MARKERS.IPC.start}
const ipc = ${ipcComp ? ipcComp.instanceTemplate : "undefined"};
${MARKERS.IPC.end}

startAgent({
  channels,
  agent,
  memory,
  queue,
  promptBuilder,
  sandbox,
  tools,
  scheduler,
  skills,
  ipc,
  config,
}).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

process.on("SIGINT", () => {
  console.log("\\nShutting down...");
  process.exit(0);
});
`;
}

export function addComponentToEntry(entryPath: string, meta: ComponentMeta, registry: Record<string, { category: string; path: string }>): void {
  if (!existsSync(entryPath)) return;
  let content = readFileSync(entryPath, "utf-8");
  const importPath = getImportPath(meta, registry);
  const importLine = `import ${meta.importName} from "${importPath}";`;

  content = insertBefore(content, MARKERS.IMPORTS.end, importLine);

  switch (meta.category) {
    case "channels":
      content = addToArray(content, MARKERS.CHANNELS, meta.instanceTemplate);
      break;
    case "agents":
      content = replaceSection(content, MARKERS.AGENT, `const agent = ${meta.instanceTemplate};`);
      break;
    case "memory":
      content = replaceSection(content, MARKERS.MEMORY, `const memory = ${meta.instanceTemplate};`);
      break;
    case "queue":
      content = replaceSection(content, MARKERS.QUEUE, `const queue = ${meta.instanceTemplate};`);
      break;
    case "prompt":
      content = replaceSection(content, MARKERS.PROMPT, `const promptBuilder = ${meta.instanceTemplate};`);
      break;
    case "sandbox":
      content = replaceSection(content, MARKERS.SANDBOX, `const sandbox = ${meta.instanceTemplate};`);
      break;
    case "tools":
      content = addToArray(content, MARKERS.TOOLS, `  ${meta.instanceTemplate}`);
      break;
    case "scheduler":
      content = replaceSection(content, MARKERS.SCHEDULER, `const scheduler = ${meta.instanceTemplate};`);
      break;
    case "skills":
      content = replaceSection(content, MARKERS.SKILLS, `const skills = ${meta.instanceTemplate};`);
      break;
    case "ipc":
      content = replaceSection(content, MARKERS.IPC, `const ipc = ${meta.instanceTemplate};`);
      break;
  }

  writeFileSync(entryPath, content, "utf-8");
}

export function removeComponentFromEntry(entryPath: string, meta: ComponentMeta): void {
  if (!existsSync(entryPath)) return;
  let content = readFileSync(entryPath, "utf-8");

  const importRegex = new RegExp(`.*import\\s+${meta.importName}\\s+from.*\\n`, "g");
  content = content.replace(importRegex, "");

  const instanceRegex = new RegExp(`.*${escapeRegex(meta.instanceTemplate)}.*\\n?`, "g");
  content = content.replace(instanceRegex, "");

  writeFileSync(entryPath, content, "utf-8");
}

function insertBefore(content: string, marker: string, line: string): string {
  if (content.includes(line)) return content;
  return content.replace(marker, `${line}\n${marker}`);
}

function addToArray(content: string, markers: { start: string; end: string }, item: string): string {
  if (content.includes(item)) return content;
  return content.replace(markers.end, `${item},\n${markers.end}`);
}

function replaceSection(content: string, markers: { start: string; end: string }, newContent: string): string {
  const startIdx = content.indexOf(markers.start) + markers.start.length;
  const endIdx = content.indexOf(markers.end);
  return content.slice(0, startIdx) + "\n" + newContent + "\n" + content.slice(endIdx);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
