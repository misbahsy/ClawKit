import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import type { AgentEvent } from "../../packages/core/src/types.js";

/**
 * Agent smoke tests — real API calls.
 * Each test is skipped if the required env var is not set.
 * Send a deterministic prompt and assert the response contains the expected string.
 */

const PROMPT = 'Reply with exactly: CLAWKIT_OK';

interface AgentTestCase {
  name: string;
  factoryPath: string;
  envKey: string;
  config: Record<string, any>;
}

const AGENT_TESTS: AgentTestCase[] = [
  {
    name: "agent-anthropic",
    factoryPath: "agents/anthropic/index.ts",
    envKey: "ANTHROPIC_API_KEY",
    config: {
      name: "agent-anthropic",
      model: "claude-sonnet-4-20250514",
      maxTokens: 256,
    },
  },
  {
    name: "agent-openai",
    factoryPath: "agents/openai/index.ts",
    envKey: "OPENAI_API_KEY",
    config: {
      name: "agent-openai",
      model: "gpt-4o-mini",
      maxTokens: 256,
    },
  },
  {
    name: "agent-openrouter",
    factoryPath: "agents/openrouter/index.ts",
    envKey: "OPENROUTER_API_KEY",
    config: {
      name: "agent-openrouter",
      model: "anthropic/claude-sonnet-4-20250514",
      maxTokens: 256,
    },
  },
  {
    name: "agent-ollama",
    factoryPath: "agents/ollama/index.ts",
    envKey: "__OLLAMA_RUNNING__", // special: checked via localhost probe
    config: {
      name: "agent-ollama",
      model: "llama3.2:1b",
      host: "http://localhost:11434",
    },
  },
  {
    name: "agent-gemini",
    factoryPath: "agents/gemini/index.ts",
    envKey: "GOOGLE_API_KEY",
    config: {
      name: "agent-gemini",
      model: "gemini-2.0-flash",
      maxTokens: 256,
    },
  },
  {
    name: "agent-deepseek",
    factoryPath: "agents/deepseek/index.ts",
    envKey: "DEEPSEEK_API_KEY",
    config: {
      name: "agent-deepseek",
      model: "deepseek-chat",
      maxTokens: 256,
    },
  },
  {
    name: "agent-generic-openai",
    factoryPath: "agents/generic-openai/index.ts",
    envKey: "OPENAI_API_KEY",
    config: {
      name: "agent-generic-openai",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
      maxTokens: 256,
    },
  },
  {
    name: "agent-bedrock",
    factoryPath: "agents/bedrock/index.ts",
    envKey: "AWS_ACCESS_KEY_ID",
    config: {
      name: "agent-bedrock",
      model: "us.anthropic.claude-sonnet-4-20250514-v1:0",
      region: "us-east-1",
      maxTokens: 256,
    },
  },
  {
    name: "agent-claude-sdk",
    factoryPath: "agents/claude-sdk/index.ts",
    envKey: "ANTHROPIC_API_KEY",
    config: {
      name: "agent-claude-sdk",
      model: "claude-sonnet-4-20250514",
      maxTurns: 1,
    },
  },
];

async function isOllamaRunning(): Promise<boolean> {
  try {
    const resp = await fetch("http://localhost:11434/api/tags", {
      signal: AbortSignal.timeout(3000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

function hasEnvKey(testCase: AgentTestCase): boolean {
  if (testCase.envKey === "__OLLAMA_RUNNING__") return true; // checked async
  return !!process.env[testCase.envKey];
}

describe("Agent smoke tests (real API calls)", () => {
  for (const tc of AGENT_TESTS) {
    it(`${tc.name}: send prompt and receive CLAWKIT_OK`, async () => {
      // Check prerequisites
      if (tc.envKey === "__OLLAMA_RUNNING__") {
        const running = await isOllamaRunning();
        if (!running) {
          return; // skip silently — Ollama not available
        }
      } else if (!process.env[tc.envKey]) {
        return; // skip — key not set
      }

      // Inject API key into config
      const config = { ...tc.config };
      if (tc.envKey === "OPENAI_API_KEY" || tc.envKey === "OPENROUTER_API_KEY" ||
          tc.envKey === "GOOGLE_API_KEY" || tc.envKey === "DEEPSEEK_API_KEY" ||
          tc.envKey === "ANTHROPIC_API_KEY") {
        config.apiKey = process.env[tc.envKey];
      }
      if (tc.envKey === "AWS_ACCESS_KEY_ID") {
        config.credentials = {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        };
      }

      const factoryPath = resolve(process.cwd(), "registry", tc.factoryPath);
      const mod = await import(factoryPath);
      const factory = mod.default;
      const agent = factory(config);

      const events: AgentEvent[] = [];
      const gen = agent.run({
        systemPrompt: "You are a test bot. Follow instructions exactly.",
        messages: [{ role: "user", content: PROMPT }],
        tools: [],
        toolExecutor: async () => ({ output: "" }),
        onEvent: () => {},
      });

      for await (const event of gen) {
        events.push(event);
      }

      // Verify we got text_done with the expected content
      const textDone = events.find((e) => e.type === "text_done");
      expect(textDone, `${tc.name}: no text_done event`).toBeDefined();
      expect(
        (textDone as any).text.toUpperCase(),
        `${tc.name}: response should contain CLAWKIT_OK`,
      ).toContain("CLAWKIT_OK");

      // Verify done event
      const done = events.find((e) => e.type === "done");
      expect(done, `${tc.name}: no done event`).toBeDefined();
    });
  }
});
