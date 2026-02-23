import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import chalk from "chalk";
import ora from "ora";
import {
  readRegistry,
  readComponentMeta,
  type ComponentMeta,
} from "../utils/registry.js";
import { copyComponent } from "../utils/scaffold.js";
import { addComponentToEntry } from "../utils/entry.js";
import { generateClaudeMd, preserveUserNotes } from "../utils/claude-md.js";

export async function addCommand(componentNames: string[]): Promise<void> {
  const projectDir = process.cwd();

  if (!existsSync(resolve(projectDir, "clawkit.config.ts"))) {
    console.error(chalk.red("Not a ClawKit project. Run `clawkit init` first."));
    process.exit(1);
  }

  const registry = readRegistry();
  let spinner = ora("Adding components...").start();
  const added: ComponentMeta[] = [];

  for (const name of componentNames) {
    try {
      spinner.text = `Adding ${name}...`;
      const meta = readComponentMeta(name);

      copyComponent(name, projectDir);

      const entryPath = resolve(projectDir, "src", "index.ts");
      addComponentToEntry(entryPath, meta, registry);

      if (Object.keys(meta.npmDependencies).length > 0) {
        const pkgPath = resolve(projectDir, "package.json");
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        pkg.dependencies = { ...pkg.dependencies, ...meta.npmDependencies };
        writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), "utf-8");
      }

      updateConfig(projectDir, meta);

      added.push(meta);
      spinner.succeed(`Added ${chalk.green(name)}`);
      spinner = ora("").start();
    } catch (err: any) {
      spinner.fail(`Failed to add ${name}: ${err.message}`);
      spinner = ora("").start();
    }
  }

  if (added.length > 0) {
    spinner.text = "Updating CLAUDE.md...";
    regenerateClaudeMd(projectDir);

    spinner.text = "Installing dependencies...";
    try {
      execSync("npm install", { cwd: projectDir, stdio: "pipe" });
    } catch {
      spinner.warn("npm install failed — run it manually");
    }

    spinner.succeed("Done!");

    const existingComponents = getInstalledComponents(projectDir);
    const suggestions = new Map<string, string>();
    for (const meta of added) {
      for (const s of meta.suggests) {
        if (!existingComponents.includes(s) && !componentNames.includes(s)) {
          suggestions.set(s, meta.suggestReason[s] ?? "");
        }
      }
    }

    if (suggestions.size > 0) {
      console.log("");
      console.log(chalk.yellow("Suggested companions:"));
      for (const [name, reason] of suggestions) {
        console.log(`  ${name}${reason ? ` — ${reason}` : ""}`);
      }
      console.log(`\n  Run: ${chalk.cyan(`npx clawkit add ${[...suggestions.keys()].join(" ")}`)}`);
    }
  }
}

function updateConfig(projectDir: string, meta: ComponentMeta): void {
  const configPath = resolve(projectDir, "clawkit.config.ts");
  if (!existsSync(configPath)) return;

  let content = readFileSync(configPath, "utf-8");
  let changed = false;

  if (meta.category === "tools" && !content.includes(`"${meta.name}"`)) {
    content = content.replace(
      /tools:\s*\[([^\]]*)\]/,
      (_match, inner) => {
        const trimmed = inner.trim();
        if (trimmed) {
          return `tools: [${trimmed}, "${meta.name}"]`;
        }
        return `tools: ["${meta.name}"]`;
      }
    );
    changed = true;
  }

  if (meta.category === "scheduler" && !content.includes("scheduler:")) {
    const defaults = Object.entries(meta.configSchema)
      .map(([key, schema]: [string, any]) => `    ${key}: ${JSON.stringify(schema.default)}`)
      .join(",\n");
    const schedulerSection = `  scheduler: {\n    name: "${meta.name}"${defaults ? ",\n" + defaults : ""},\n  },`;
    content = content.replace(/}\);(\s*)$/, `${schedulerSection}\n});$1`);
    changed = true;
  }

  if (meta.category === "skills" && !content.includes("skills:")) {
    const skillsSection = `  skills: {\n    mcp: [],\n    markdown: [],\n  },`;
    content = content.replace(/}\);(\s*)$/, `${skillsSection}\n});$1`);
    changed = true;
  }

  if (meta.category === "ipc" && !content.includes("ipc:")) {
    const defaults = Object.entries(meta.configSchema)
      .map(([key, schema]: [string, any]) => `    ${key}: ${JSON.stringify(schema.default)}`)
      .join(",\n");
    const ipcSection = `  ipc: {\n    name: "${meta.name}"${defaults ? ",\n" + defaults : ""},\n  },`;
    content = content.replace(/}\);(\s*)$/, `${ipcSection}\n});$1`);
    changed = true;
  }

  if (changed) {
    writeFileSync(configPath, content, "utf-8");
  }
}

function regenerateClaudeMd(projectDir: string): void {
  const configPath = resolve(projectDir, "clawkit.config.ts");
  if (!existsSync(configPath)) return;

  const installed = getInstalledComponents(projectDir);
  const metas: ComponentMeta[] = [];
  for (const name of installed) {
    try {
      metas.push(readComponentMeta(name));
    } catch {
      // Skip unknown components
    }
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

function getInstalledComponents(projectDir: string): string[] {
  const registry = readRegistry();
  const installed: string[] = [];

  for (const [name, entry] of Object.entries(registry)) {
    const compDir = resolve(projectDir, "components", entry.path);
    if (existsSync(compDir)) {
      installed.push(name);
    }
  }

  return installed;
}
