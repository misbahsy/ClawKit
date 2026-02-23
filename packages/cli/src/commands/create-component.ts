import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { getRegistryDir } from "../utils/registry.js";

const VALID_CATEGORIES = [
  "channels",
  "agents",
  "memory",
  "tools",
  "queue",
  "prompt",
  "sandbox",
  "scheduler",
  "skills",
  "ipc",
] as const;

type Category = (typeof VALID_CATEGORIES)[number];

const INTERFACE_MAP: Record<Category, string> = {
  channels: "Channel",
  agents: "AgentRuntime",
  memory: "Memory",
  tools: "Tool",
  queue: "Queue",
  prompt: "PromptBuilder",
  sandbox: "Sandbox",
  scheduler: "Scheduler",
  skills: "SkillsManager",
  ipc: "IPC",
};

function toPascalCase(name: string): string {
  return name
    .split(/[-_]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function generateIndexTs(name: string, category: Category): string {
  const pascal = toPascalCase(name);
  const iface = INTERFACE_MAP[category];

  return `import type { ${iface} } from "clawkit:types";

export interface ${pascal}Config {
  name?: string;
}

export default function create${pascal}(config: ${pascal}Config): ${iface} {
  return {
    name: "${name}",
    // TODO: implement ${iface} methods
  };
}
`;
}

function generateMetaJson(name: string, category: Category): string {
  const pascal = toPascalCase(name);

  const meta = {
    name,
    category,
    description: `TODO: describe ${name}`,
    npmDependencies: {},
    suggests: [],
    suggestReason: {},
    configSchema: {},
    importName: `create${pascal}`,
    instanceTemplate: `create${pascal}(config.${category}?.${name.replace(/-/g, "_")} ?? {})`,
    phase: 0,
  };

  return JSON.stringify(meta, null, 2) + "\n";
}

export async function createComponentCommand(
  name: string,
  options: { category: string },
): Promise<void> {
  const category = options.category as Category;

  if (!VALID_CATEGORIES.includes(category)) {
    console.error(
      chalk.red(
        `Invalid category "${category}". Valid categories: ${VALID_CATEGORIES.join(", ")}`,
      ),
    );
    process.exit(1);
  }

  const registryDir = getRegistryDir();
  const componentDir = resolve(registryDir, category, name);

  if (existsSync(componentDir)) {
    console.error(chalk.red(`Component directory already exists: ${componentDir}`));
    process.exit(1);
  }

  const spinner = ora(`Creating component ${name} in ${category}...`).start();

  // Create component directory
  mkdirSync(componentDir, { recursive: true });

  // Write index.ts
  writeFileSync(resolve(componentDir, "index.ts"), generateIndexTs(name, category), "utf-8");

  // Write meta.json
  writeFileSync(resolve(componentDir, "meta.json"), generateMetaJson(name, category), "utf-8");

  // Update registry.json
  const registryJsonPath = resolve(registryDir, "registry.json");
  const registryData = JSON.parse(readFileSync(registryJsonPath, "utf-8"));
  registryData.components[name] = {
    category,
    path: `${category}/${name}`,
  };
  writeFileSync(registryJsonPath, JSON.stringify(registryData, null, 2) + "\n", "utf-8");

  spinner.succeed(chalk.green(`Created component ${chalk.bold(name)} in ${category}`));

  console.log("");
  console.log(`  ${chalk.dim("index.ts")}   ${resolve(componentDir, "index.ts")}`);
  console.log(`  ${chalk.dim("meta.json")} ${resolve(componentDir, "meta.json")}`);
  console.log(`  ${chalk.dim("registry")}  updated registry.json`);
  console.log("");
  console.log(`  Next: edit the generated files, then run ${chalk.cyan(`clawkit add ${name}`)}`);
  console.log("");
}
