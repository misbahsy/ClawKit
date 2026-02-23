#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { addCommand } from "./commands/add.js";
import { removeCommand } from "./commands/remove.js";
import { listCommand } from "./commands/list.js";
import { statusCommand } from "./commands/status.js";

const program = new Command();

program
  .name("clawkit")
  .description("Component registry for building AI agents")
  .version("0.1.0");

program
  .command("init")
  .argument("<name>", "Project name")
  .option("-t, --template <preset>", "Use a preset template (minimal)")
  .description("Scaffold a new ClawKit agent project")
  .action(async (name: string, options: { template?: string }) => {
    await initCommand(name, options);
  });

program
  .command("add")
  .argument("<components...>", "Component names to add")
  .description("Add components to the current project")
  .action(async (components: string[]) => {
    await addCommand(components);
  });

program
  .command("remove")
  .argument("<component>", "Component name to remove")
  .description("Remove a component from the current project")
  .action(async (component: string) => {
    await removeCommand(component);
  });

program
  .command("list")
  .argument("[category]", "Filter by category (channels, agents, memory, etc.)")
  .description("List available components")
  .action(async (category?: string) => {
    await listCommand(category);
  });

program
  .command("status")
  .description("Show installed components in the current project")
  .action(async () => {
    await statusCommand();
  });

program.parse();
