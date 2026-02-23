import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { readRegistry, readComponentMeta } from "../utils/registry.js";
import { removeComponentFromEntry } from "../utils/entry.js";
import { validateProjectDir, regenerateClaudeMd } from "../utils/claude-md.js";

export async function removeCommand(componentName: string): Promise<void> {
  const projectDir = process.cwd();
  validateProjectDir(projectDir);

  const registry = readRegistry();
  const entry = registry[componentName];
  if (!entry) {
    console.error(chalk.red(`Unknown component: ${componentName}`));
    process.exit(1);
  }

  const compDir = resolve(projectDir, "components", entry.path);
  if (!existsSync(compDir)) {
    console.error(chalk.red(`Component "${componentName}" is not installed.`));
    process.exit(1);
  }

  const spinner = ora(`Removing ${componentName}...`).start();

  try {
    const meta = readComponentMeta(componentName);

    rmSync(compDir, { recursive: true, force: true });

    const entryPath = resolve(projectDir, "src", "index.ts");
    removeComponentFromEntry(entryPath, meta);

    const configPath = resolve(projectDir, "clawkit.config.ts");
    if (existsSync(configPath)) {
      let content = readFileSync(configPath, "utf-8");
      content = content.replace(new RegExp(`\\s*"${meta.name}",?`, "g"), "");
      content = content.replace(/,(\s*\])/g, "$1");
      writeFileSync(configPath, content, "utf-8");
    }

    regenerateClaudeMd(projectDir);

    spinner.succeed(`Removed ${chalk.red(componentName)}`);
  } catch (err: any) {
    spinner.fail(`Failed to remove ${componentName}: ${err.message}`);
  }
}

