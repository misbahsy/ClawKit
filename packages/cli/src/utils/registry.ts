import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface RegistryEntry {
  category: string;
  path: string;
}

export interface ComponentMeta {
  name: string;
  category: string;
  description: string;
  npmDependencies: Record<string, string>;
  suggests: string[];
  suggestReason: Record<string, string>;
  configSchema: Record<string, any>;
  importName: string;
  instanceTemplate: string;
  phase: number;
}

export function getRegistryDir(): string {
  // __dirname = packages/cli/dist (when bundled) or packages/cli/src/utils (when unbundled)
  // Walk up until we find registry/registry.json
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    const candidate = resolve(dir, "registry", "registry.json");
    if (existsSync(candidate)) {
      return resolve(dir, "registry");
    }
    dir = resolve(dir, "..");
  }
  // Fallback: assume dist/ inside packages/cli/ inside monorepo
  return resolve(__dirname, "..", "..", "..", "registry");
}

export function readRegistry(): Record<string, RegistryEntry> {
  const registryPath = resolve(getRegistryDir(), "registry.json");
  const data = JSON.parse(readFileSync(registryPath, "utf-8"));
  return data.components;
}

export function readComponentMeta(componentName: string): ComponentMeta {
  const registry = readRegistry();
  const entry = registry[componentName];
  if (!entry) {
    throw new Error(`Component "${componentName}" not found in registry`);
  }
  const metaPath = resolve(getRegistryDir(), entry.path, "meta.json");
  if (!existsSync(metaPath)) {
    throw new Error(`meta.json not found for component "${componentName}" at ${metaPath}`);
  }
  return JSON.parse(readFileSync(metaPath, "utf-8"));
}

export function getComponentDir(componentName: string): string {
  const registry = readRegistry();
  const entry = registry[componentName];
  if (!entry) {
    throw new Error(`Component "${componentName}" not found in registry`);
  }
  return resolve(getRegistryDir(), entry.path);
}

export function listComponents(category?: string): Array<{ name: string; entry: RegistryEntry }> {
  const registry = readRegistry();
  return Object.entries(registry)
    .filter(([_, entry]) => !category || entry.category === category)
    .map(([name, entry]) => ({ name, entry }));
}
