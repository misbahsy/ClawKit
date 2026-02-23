import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { existsSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

// Test the scaffolding utilities directly instead of spawning CLI process
import { readRegistry, readComponentMeta } from "../../packages/cli/src/utils/registry.js";
import {
  copyCore,
  copyComponent,
  generatePackageJson,
  generateTsconfig,
  generateConfig,
} from "../../packages/cli/src/utils/scaffold.js";
import { generateEntryPoint } from "../../packages/cli/src/utils/entry.js";
import { generateClaudeMd } from "../../packages/cli/src/utils/claude-md.js";

describe("clawkit init (scaffolding)", () => {
  let projectDir: string;

  const DEFAULT_COMPONENTS = [
    "cli", "agent-anthropic", "memory-sqlite",
    "queue-simple", "prompt-simple", "sandbox-none",
    "tool-bash", "tool-file-read", "tool-file-write",
  ];

  beforeEach(() => {
    projectDir = resolve(tmpdir(), `clawkit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(resolve(projectDir, "src"), { recursive: true });
    mkdirSync(resolve(projectDir, "workspace"), { recursive: true });
    mkdirSync(resolve(projectDir, "data"), { recursive: true });
    mkdirSync(resolve(projectDir, "components"), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(projectDir)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("should copy core files", () => {
    copyCore(projectDir);

    expect(existsSync(resolve(projectDir, "core", "types.ts"))).toBe(true);
    expect(existsSync(resolve(projectDir, "core", "runtime.ts"))).toBe(true);
    expect(existsSync(resolve(projectDir, "core", "config.ts"))).toBe(true);
    expect(existsSync(resolve(projectDir, "core", "index.ts"))).toBe(true);
  });

  it("should copy all 9 default components", () => {
    for (const comp of DEFAULT_COMPONENTS) {
      copyComponent(comp, projectDir);
    }

    expect(existsSync(resolve(projectDir, "components", "channels", "cli", "index.ts"))).toBe(true);
    expect(existsSync(resolve(projectDir, "components", "agents", "anthropic", "index.ts"))).toBe(true);
    expect(existsSync(resolve(projectDir, "components", "memory", "sqlite", "index.ts"))).toBe(true);
    expect(existsSync(resolve(projectDir, "components", "tools", "bash", "index.ts"))).toBe(true);
    expect(existsSync(resolve(projectDir, "components", "tools", "file-read", "index.ts"))).toBe(true);
    expect(existsSync(resolve(projectDir, "components", "tools", "file-write", "index.ts"))).toBe(true);
    expect(existsSync(resolve(projectDir, "components", "queue", "simple", "index.ts"))).toBe(true);
    expect(existsSync(resolve(projectDir, "components", "prompt", "simple", "index.ts"))).toBe(true);
    expect(existsSync(resolve(projectDir, "components", "sandbox", "none", "index.ts"))).toBe(true);
  });

  it("should rewrite magic imports to relative paths", () => {
    copyComponent("cli", projectDir);

    const content = readFileSync(
      resolve(projectDir, "components", "channels", "cli", "index.ts"),
      "utf-8"
    );

    expect(content).not.toContain("clawkit:types");
    expect(content).toContain("core/types.js");
  });

  it("should generate valid package.json", () => {
    const metas = DEFAULT_COMPONENTS.map((c) => readComponentMeta(c));
    const result = generatePackageJson("test-project", metas);
    const pkg = JSON.parse(result);

    expect(pkg.name).toBe("test-project");
    expect(pkg.type).toBe("module");
    expect(pkg.scripts.start).toContain("tsx");
    expect(pkg.dependencies["@anthropic-ai/sdk"]).toBeDefined();
    expect(pkg.dependencies["better-sqlite3"]).toBeDefined();
    expect(pkg.dependencies["tsx"]).toBeDefined();
  });

  it("should generate config with all component sections", () => {
    const metas = DEFAULT_COMPONENTS.map((c) => readComponentMeta(c));
    const config = generateConfig("test-project", metas);

    expect(config).toContain("agent-anthropic");
    expect(config).toContain("memory-sqlite");
    expect(config).toContain("queue-simple");
    expect(config).toContain("prompt-simple");
    expect(config).toContain("sandbox-none");
    expect(config).toContain("tool-bash");
  });

  it("should generate entry point with marked sections", () => {
    const metas = DEFAULT_COMPONENTS.map((c) => readComponentMeta(c));
    const registry = readRegistry();
    const entry = generateEntryPoint(metas, registry);

    expect(entry).toContain("// === IMPORTS ===");
    expect(entry).toContain("// === /IMPORTS ===");
    expect(entry).toContain("// === CHANNELS ===");
    expect(entry).toContain("// === SCHEDULER ===");
    expect(entry).toContain("// === /SCHEDULER ===");
    expect(entry).toContain("// === SKILLS ===");
    expect(entry).toContain("// === /SKILLS ===");
    expect(entry).toContain("// === IPC ===");
    expect(entry).toContain("// === /IPC ===");
    expect(entry).toContain("startAgent");
    expect(entry).toContain("createCliChannel");
    expect(entry).toContain("createAnthropicAgent");
    expect(entry).toContain("createSqliteMemory");
    expect(entry).toContain("createBashTool");
  });

  it("should generate entry point with scheduler and skills when present", () => {
    const baseComponents = DEFAULT_COMPONENTS.map((c) => readComponentMeta(c));
    const schedulerMeta = readComponentMeta("scheduler-cron");
    const skillsMeta = readComponentMeta("skills-mcp-client");
    const allComponents = [...baseComponents, schedulerMeta, skillsMeta];
    const registry = readRegistry();
    const entry = generateEntryPoint(allComponents, registry);

    expect(entry).toContain("createCronScheduler");
    expect(entry).toContain("createMCPSkillsManager");
    expect(entry).toContain("scheduler,");
    expect(entry).toContain("skills,");
  });

  it("should generate entry point with IPC when present", () => {
    const baseComponents = DEFAULT_COMPONENTS.map((c) => readComponentMeta(c));
    const ipcMeta = readComponentMeta("ipc-filesystem");
    const allComponents = [...baseComponents, ipcMeta];
    const registry = readRegistry();
    const entry = generateEntryPoint(allComponents, registry);

    expect(entry).toContain("createFilesystemIPC");
    expect(entry).toContain("ipc,");
  });

  it("should generate config with IPC section when present", () => {
    const baseComponents = DEFAULT_COMPONENTS.map((c) => readComponentMeta(c));
    const ipcMeta = readComponentMeta("ipc-filesystem");
    const allComponents = [...baseComponents, ipcMeta];
    const config = generateConfig("test-project", allComponents);

    expect(config).toContain("ipc:");
    expect(config).toContain("ipc-filesystem");
  });

  it("should generate CLAUDE.md with architecture summary", () => {
    const metas = DEFAULT_COMPONENTS.map((c) => readComponentMeta(c));
    const claudeMd = generateClaudeMd("test-project", metas);

    expect(claudeMd).toContain("# Agent: test-project");
    expect(claudeMd).toContain("ClawKit");
    expect(claudeMd).toContain("## Architecture");
    expect(claudeMd).toContain("## Tools");
    expect(claudeMd).toContain("## Message Flow");
    expect(claudeMd).toContain("<!-- USER NOTES -->");
  });

  it("should not include meta.json in copied components", () => {
    copyComponent("cli", projectDir);

    expect(existsSync(resolve(projectDir, "components", "channels", "cli", "meta.json"))).toBe(false);
  });
});
