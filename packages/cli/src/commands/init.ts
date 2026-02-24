import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import chalk from "chalk";
import ora from "ora";
import {
  readRegistry,
  readComponentMeta,
  type ComponentMeta,
} from "../utils/registry.js";
import {
  copyCore,
  copyComponent,
  generatePackageJson,
  generateTsconfig,
  generateConfig,
} from "../utils/scaffold.js";
import { generateEntryPoint } from "../utils/entry.js";
import { generateClaudeMd } from "../utils/claude-md.js";
import { PRESETS, DEFAULT_PRESET, getPreset, listPresets } from "../presets.js";

export async function initCommand(name: string, options: { template?: string }): Promise<void> {
  const projectDir = resolve(process.cwd(), name);

  if (existsSync(projectDir)) {
    console.error(chalk.red(`Directory "${name}" already exists.`));
    process.exit(1);
  }

  const spinner = ora(`Creating ${name}...`).start();

  mkdirSync(projectDir, { recursive: true });
  mkdirSync(resolve(projectDir, "src"), { recursive: true });
  mkdirSync(resolve(projectDir, "workspace"), { recursive: true });
  mkdirSync(resolve(projectDir, "data"), { recursive: true });
  mkdirSync(resolve(projectDir, "components"), { recursive: true });

  spinner.text = "Copying core runtime...";
  copyCore(projectDir);

  const preset = options.template
    ? getPreset(options.template)
    : getPreset(DEFAULT_PRESET);

  if (options.template && !preset) {
    spinner.fail(chalk.red(`Unknown template "${options.template}". Available: ${listPresets().map(p => p.name).join(", ")}`));
    process.exit(1);
  }

  const componentNames = preset!.components;

  const metas: ComponentMeta[] = [];
  spinner.text = "Copying components...";
  for (const compName of componentNames) {
    try {
      metas.push(readComponentMeta(compName));
      copyComponent(compName, projectDir);
    } catch (err: any) {
      spinner.warn(`Skipping ${compName}: ${err.message}`);
    }
  }

  spinner.text = "Generating project files...";
  writeFileSync(
    resolve(projectDir, "package.json"),
    generatePackageJson(name, metas),
    "utf-8"
  );

  writeFileSync(
    resolve(projectDir, "tsconfig.json"),
    generateTsconfig(),
    "utf-8"
  );

  writeFileSync(
    resolve(projectDir, "clawkit.config.ts"),
    generateConfig(name, metas),
    "utf-8"
  );

  const registry = readRegistry();
  writeFileSync(
    resolve(projectDir, "src", "index.ts"),
    generateEntryPoint(metas, registry),
    "utf-8"
  );

  writeFileSync(
    resolve(projectDir, "CLAUDE.md"),
    generateClaudeMd(name, metas),
    "utf-8"
  );

  writeFileSync(
    resolve(projectDir, "workspace", "AGENTS.md"),
    `# Agent Identity\n\nYou are ${name}, a helpful AI assistant.\n`,
    "utf-8"
  );
  writeFileSync(
    resolve(projectDir, "workspace", "SOUL.md"),
    `# Personality\n\nBe helpful, concise, and honest.\n`,
    "utf-8"
  );
  writeFileSync(
    resolve(projectDir, "workspace", "TOOLS.md"),
    `# Tool Usage\n\nUse tools when needed to accomplish tasks.\n`,
    "utf-8"
  );
  writeFileSync(
    resolve(projectDir, "workspace", "USER.md"),
    `# User Profile\n\nNo user profile configured yet.\n`,
    "utf-8"
  );

  const envLines = preset!.envKeys.map((key) => `${key}=your-${key.toLowerCase().replace(/_/g, "-")}-here`);
  if (envLines.length === 0) {
    envLines.push("# No API keys required for this preset");
  }
  writeFileSync(
    resolve(projectDir, ".env.example"),
    envLines.join("\n") + "\n",
    "utf-8"
  );

  spinner.text = "Installing dependencies...";
  try {
    execSync("npm install", { cwd: projectDir, stdio: "pipe" });
  } catch {
    spinner.warn("npm install failed — run it manually");
  }

  spinner.succeed(chalk.green(`Created ${name}! (preset: ${preset!.name})`));

  console.log("");
  console.log(`  ${chalk.cyan("cd")} ${name}`);
  for (const key of preset!.envKeys) {
    console.log(`  ${chalk.cyan("export")} ${key}=...`);
  }
  console.log(`  ${chalk.cyan("npm")} start`);
  console.log("");
}
