import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync } from "node:fs";
import { PRESETS, listPresets, getPreset } from "../../packages/cli/src/presets.js";
import { readRegistry, readComponentMeta } from "../../packages/cli/src/utils/registry.js";
import { startAgent, type ClawKitComponents } from "../../packages/core/src/runtime.js";
import type { ClawKitConfig } from "../../packages/core/src/types.js";
import {
  createMockAgent,
  createMockChannel,
  createMockMemory,
  createMockQueue,
  createMockPrompt,
  createTestMessage,
  waitFor,
} from "./helpers.js";

// readRegistry() returns Record<string, RegistryEntry> directly
const registry = readRegistry();

describe("Presets — definitions", () => {
  it("should export exactly 10 presets", () => {
    expect(listPresets()).toHaveLength(10);
  });

  it("should have a preset for each expected name", () => {
    const expected = [
      "minimal",
      "local-ollama",
      "openai-full",
      "gemini-starter",
      "deepseek-coder",
      "openrouter-multi",
      "enterprise-aws",
      "webchat-demo",
      "webhook-api",
      "full-stack",
    ];
    for (const name of expected) {
      expect(getPreset(name), `missing preset: ${name}`).toBeDefined();
    }
  });

  it("every preset should include common infrastructure", () => {
    const infra = ["queue-simple", "prompt-simple", "sandbox-none"];
    for (const preset of listPresets()) {
      for (const comp of infra) {
        expect(
          preset.components.includes(comp),
          `${preset.name} missing ${comp}`,
        ).toBe(true);
      }
    }
  });

  it("every preset should have a description", () => {
    for (const preset of listPresets()) {
      expect(preset.description.length).toBeGreaterThan(0);
    }
  });

  it("every preset component should exist in the registry", () => {
    for (const preset of listPresets()) {
      for (const comp of preset.components) {
        expect(
          registry[comp],
          `${preset.name} references unknown component: ${comp}`,
        ).toBeDefined();
      }
    }
  });
});

describe("Presets — component files exist", () => {
  for (const preset of listPresets()) {
    it(`${preset.name}: all component files and meta.json exist`, () => {
      for (const compName of preset.components) {
        const entry = registry[compName];
        expect(entry, `${preset.name}: "${compName}" not in registry`).toBeDefined();

        const compPath = resolve(
          process.cwd(),
          "registry",
          entry.path,
          "index.ts",
        );
        expect(
          existsSync(compPath),
          `component file missing: ${compPath}`,
        ).toBe(true);

        const metaPath = resolve(
          process.cwd(),
          "registry",
          entry.path,
          "meta.json",
        );
        expect(
          existsSync(metaPath),
          `meta.json missing for ${compName}`,
        ).toBe(true);
      }
    });
  }
});

describe("Presets — wiring smoke test", () => {
  for (const preset of listPresets()) {
    it(`${preset.name}: mock channel → queue → agent → response`, async () => {
      const channel = createMockChannel();
      const agent = createMockAgent(`Hello from ${preset.name}`);
      const memory = createMockMemory();
      const queue = createMockQueue();
      const prompt = createMockPrompt();

      const config: ClawKitConfig = {
        name: `test-${preset.name}`,
        typescript: true,
        aliases: { components: "./components", workspace: "./workspace" },
      };

      const components: ClawKitComponents = {
        channels: [channel],
        agent,
        memory,
        queue,
        promptBuilder: prompt,
        tools: [],
        config,
      };

      await startAgent(components);

      channel.triggerMessage(createTestMessage("smoke test"));

      await waitFor(150);

      expect(channel.sentMessages).toHaveLength(1);
      expect(channel.sentMessages[0].text).toBe(`Hello from ${preset.name}`);
    });
  }
});

describe("Presets — component metadata", () => {
  for (const preset of listPresets()) {
    it(`${preset.name}: all component metas are readable`, () => {
      for (const compName of preset.components) {
        const meta = readComponentMeta(compName);
        expect(meta).toBeDefined();
        expect(meta.name).toBe(compName);
      }
    });
  }
});
