import { cpSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { getRegistryDir, getComponentDir, readComponentMeta, type ComponentMeta } from "./registry.js";

const MAGIC_IMPORT = /from\s+["']clawkit:types["']/g;

export function copyCore(projectDir: string): void {
  const coreSource = resolve(getRegistryDir(), "..", "packages", "core", "src");
  const coreDest = resolve(projectDir, "core");
  mkdirSync(coreDest, { recursive: true });
  cpSync(coreSource, coreDest, { recursive: true });
}

export function copyComponent(componentName: string, projectDir: string): void {
  const srcDir = getComponentDir(componentName);

  const registryData = JSON.parse(readFileSync(resolve(getRegistryDir(), "registry.json"), "utf-8"));
  const entry = registryData.components[componentName];
  const destDirFinal = resolve(projectDir, "components", entry.path);

  mkdirSync(destDirFinal, { recursive: true });
  // Copy all files except meta.json
  copyDirFiltered(srcDir, destDirFinal);

  // Rewrite magic imports in all .ts files
  rewriteImportsInDir(destDirFinal, projectDir);
}

function copyDirFiltered(src: string, dest: string): void {
  const entries = readdirSync(src);
  for (const entry of entries) {
    if (entry === "meta.json") continue;
    const srcPath = resolve(src, entry);
    const destPath = resolve(dest, entry);
    const stat = statSync(srcPath);
    if (stat.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyDirFiltered(srcPath, destPath);
    } else {
      writeFileSync(destPath, readFileSync(srcPath));
    }
  }
}

function rewriteImportsInDir(dir: string, projectDir: string): void {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = resolve(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      rewriteImportsInDir(fullPath, projectDir);
    } else if (entry.endsWith(".ts")) {
      rewriteImports(fullPath, projectDir);
    }
  }
}

function rewriteImports(filePath: string, projectDir: string): void {
  let content = readFileSync(filePath, "utf-8");
  const coreTypesPath = resolve(projectDir, "core", "types.js");
  const relPath = relative(dirname(filePath), coreTypesPath).replace(/\\/g, "/");
  const relPathFormatted = relPath.startsWith(".") ? relPath : `./${relPath}`;

  content = content.replace(MAGIC_IMPORT, `from "${relPathFormatted}"`);
  writeFileSync(filePath, content, "utf-8");
}

export function generatePackageJson(name: string, components: ComponentMeta[]): string {
  const deps: Record<string, string> = {
    tsx: "^4.0.0",
  };

  for (const comp of components) {
    Object.assign(deps, comp.npmDependencies);
  }

  const sortedDeps = Object.fromEntries(
    Object.entries(deps).sort(([a], [b]) => a.localeCompare(b))
  );

  const pkg = {
    name,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: {
      start: "npx tsx src/index.ts",
      dev: "npx tsx --watch src/index.ts",
    },
    dependencies: sortedDeps,
  };

  return JSON.stringify(pkg, null, 2);
}

export function generateTsconfig(): string {
  const config = {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      outDir: "dist",
      rootDir: ".",
    },
    include: ["src", "core", "components"],
    exclude: ["node_modules", "dist", "data"],
  };

  return JSON.stringify(config, null, 2);
}

export function generateConfig(name: string, components: ComponentMeta[]): string {
  const channelConfigs: string[] = [];
  let agentConfig = "";
  let memoryConfig = "";
  let queueConfig = "";
  let promptConfig = "";
  let sandboxConfig = "";
  let schedulerConfig = "";
  let skillsConfig = "";
  let ipcConfig = "";
  const toolNames: string[] = [];

  for (const comp of components) {
    switch (comp.category) {
      case "channels": {
        const defaults = Object.entries(comp.configSchema)
          .map(([key, schema]: [string, any]) => `      ${key}: ${JSON.stringify(schema.default)}`)
          .join(",\n");
        channelConfigs.push(`    ${comp.name}: {\n${defaults}\n    }`);
        break;
      }
      case "agents": {
        const defaults = Object.entries(comp.configSchema)
          .filter(([key]) => key !== "apiKey")
          .map(([key, schema]: [string, any]) => `    ${key}: ${JSON.stringify(schema.default)}`)
          .join(",\n");
        agentConfig = `    name: "${comp.name}",\n${defaults}`;
        break;
      }
      case "memory": {
        const defaults = Object.entries(comp.configSchema)
          .map(([key, schema]: [string, any]) => `    ${key}: ${JSON.stringify(schema.default)}`)
          .join(",\n");
        memoryConfig = `    name: "${comp.name}",\n${defaults}`;
        break;
      }
      case "queue": {
        const defaults = Object.entries(comp.configSchema)
          .map(([key, schema]: [string, any]) => `    ${key}: ${JSON.stringify(schema.default)}`)
          .join(",\n");
        queueConfig = `    name: "${comp.name}"${defaults ? ",\n" + defaults : ""}`;
        break;
      }
      case "prompt": {
        promptConfig = `    name: "${comp.name}"`;
        break;
      }
      case "sandbox": {
        sandboxConfig = `    name: "${comp.name}"`;
        break;
      }
      case "tools": {
        toolNames.push(`"${comp.name}"`);
        break;
      }
      case "scheduler": {
        const defaults = Object.entries(comp.configSchema)
          .map(([key, schema]: [string, any]) => `    ${key}: ${JSON.stringify(schema.default)}`)
          .join(",\n");
        schedulerConfig = `    name: "${comp.name}"${defaults ? ",\n" + defaults : ""}`;
        break;
      }
      case "skills": {
        skillsConfig = `    mcp: [],\n    markdown: []`;
        break;
      }
      case "ipc": {
        const defaults = Object.entries(comp.configSchema)
          .map(([key, schema]: [string, any]) => `    ${key}: ${JSON.stringify(schema.default)}`)
          .join(",\n");
        ipcConfig = `    name: "${comp.name}"${defaults ? ",\n" + defaults : ""}`;
        break;
      }
    }
  }

  return `import { defineConfig } from "./core/config.js";

export default defineConfig({
  name: "${name}",
  typescript: true,
  aliases: {
    components: "./components",
    workspace: "./workspace",
  },
${channelConfigs.length > 0 ? `  channels: {\n${channelConfigs.join(",\n")},\n  },` : ""}
${agentConfig ? `  agent: {\n${agentConfig},\n  },` : ""}
${memoryConfig ? `  memory: {\n${memoryConfig},\n  },` : ""}
${queueConfig ? `  queue: {\n${queueConfig},\n  },` : ""}
${promptConfig ? `  prompt: {\n${promptConfig},\n  },` : ""}
${sandboxConfig ? `  sandbox: {\n${sandboxConfig},\n  },` : ""}
${schedulerConfig ? `  scheduler: {\n${schedulerConfig},\n  },` : ""}
${toolNames.length > 0 ? `  tools: [${toolNames.join(", ")}],` : ""}
${skillsConfig ? `  skills: {\n${skillsConfig},\n  },` : ""}
${ipcConfig ? `  ipc: {\n${ipcConfig},\n  },` : ""}
});
`;
}
