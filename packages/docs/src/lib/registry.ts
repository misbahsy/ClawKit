import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const REGISTRY_DIR = resolve(process.cwd(), "../../registry");

interface RegistryEntry {
  category: string;
  path: string;
}

interface ComponentMeta {
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

interface ComponentData {
  id: string;
  meta: ComponentMeta;
  source: string;
  entry: RegistryEntry;
}

export function getRegistry(): Record<string, RegistryEntry> {
  const registryPath = resolve(REGISTRY_DIR, "registry.json");
  const data = JSON.parse(readFileSync(registryPath, "utf-8"));
  return data.components;
}

export function getComponent(id: string): ComponentData | null {
  const registry = getRegistry();
  const entry = registry[id];
  if (!entry) return null;

  const componentDir = resolve(REGISTRY_DIR, entry.path);
  const metaPath = join(componentDir, "meta.json");
  const indexPath = join(componentDir, "index.ts");

  if (!existsSync(metaPath)) return null;

  const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
  const source = existsSync(indexPath) ? readFileSync(indexPath, "utf-8") : "";

  return { id, meta, source, entry };
}

export function getAllComponents(): ComponentData[] {
  const registry = getRegistry();
  return Object.keys(registry)
    .map(id => getComponent(id))
    .filter((c): c is ComponentData => c !== null)
    .sort((a, b) => a.meta.category.localeCompare(b.meta.category) || a.id.localeCompare(b.id));
}

export function getCategories(): string[] {
  const components = getAllComponents();
  return [...new Set(components.map(c => c.meta.category))].sort();
}

export function getComponentsByCategory(category: string): ComponentData[] {
  return getAllComponents().filter(c => c.meta.category === category);
}
