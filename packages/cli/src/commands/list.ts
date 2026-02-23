import chalk from "chalk";
import { listComponents, readComponentMeta } from "../utils/registry.js";

export async function listCommand(category?: string): Promise<void> {
  const components = listComponents(category);

  if (components.length === 0) {
    if (category) {
      console.log(chalk.yellow(`No components found in category "${category}".`));
    } else {
      console.log(chalk.yellow("No components found."));
    }
    return;
  }

  // Group by category
  const grouped = new Map<string, Array<{ name: string; description: string; phase: number }>>();

  for (const { name, entry } of components) {
    try {
      const meta = readComponentMeta(name);
      const cat = entry.category;
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push({
        name,
        description: meta.description,
        phase: meta.phase,
      });
    } catch {
      const cat = entry.category;
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push({ name, description: "(no meta.json)", phase: 0 });
    }
  }

  for (const [cat, items] of grouped) {
    console.log(chalk.bold.underline(`\n${cat}`));
    for (const item of items) {
      const phaseTag = item.phase > 0 ? chalk.dim(` [Phase ${item.phase}]`) : "";
      console.log(`  ${chalk.cyan(item.name.padEnd(20))} ${item.description}${phaseTag}`);
    }
  }
  console.log("");
}
