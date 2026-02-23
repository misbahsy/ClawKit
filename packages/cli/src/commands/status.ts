import { existsSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import { readRegistry, readComponentMeta } from "../utils/registry.js";

export async function statusCommand(): Promise<void> {
  const projectDir = process.cwd();

  if (!existsSync(resolve(projectDir, "clawkit.config.ts"))) {
    console.error(chalk.red("Not a ClawKit project. Run `clawkit init` first."));
    process.exit(1);
  }

  const registry = readRegistry();
  const installed: Array<{ name: string; category: string; description: string }> = [];

  for (const [name, entry] of Object.entries(registry)) {
    const compDir = resolve(projectDir, "components", entry.path);
    if (existsSync(compDir)) {
      try {
        const meta = readComponentMeta(name);
        installed.push({ name, category: entry.category, description: meta.description });
      } catch {
        installed.push({ name, category: entry.category, description: "(installed)" });
      }
    }
  }

  if (installed.length === 0) {
    console.log(chalk.yellow("No components installed."));
    return;
  }

  console.log(chalk.bold(`\nInstalled components (${installed.length}):\n`));

  const grouped = new Map<string, typeof installed>();
  for (const comp of installed) {
    if (!grouped.has(comp.category)) grouped.set(comp.category, []);
    grouped.get(comp.category)!.push(comp);
  }

  for (const [cat, items] of grouped) {
    console.log(chalk.bold.underline(cat));
    for (const item of items) {
      console.log(`  ${chalk.green(item.name.padEnd(20))} ${item.description}`);
    }
    console.log("");
  }
}
