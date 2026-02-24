export interface Preset {
  name: string;
  description: string;
  components: string[];
  envKeys: string[];
}

const COMMON_INFRA = ["queue-simple", "prompt-simple", "sandbox-none"];

const TOOLS_BASIC = ["tool-bash", "tool-file-read", "tool-file-write"];

const TOOLS_DEV = [
  ...TOOLS_BASIC,
  "tool-file-edit",
  "tool-git",
];

const TOOLS_ALL = [
  ...TOOLS_DEV,
  "tool-file-search",
  "tool-web-fetch",
  "tool-web-search",
  "tool-http-request",
  "tool-memory-read",
  "tool-memory-write",
  "tool-send-message",
  "tool-spawn-agent",
  "tool-cron",
  "tool-delegate",
  "tool-browser",
  "tool-screenshot",
];

export const PRESETS: Record<string, Preset> = {
  minimal: {
    name: "minimal",
    description: "Anthropic agent with CLI — the simplest way to start",
    components: [
      "cli",
      "agent-anthropic",
      "memory-sqlite",
      ...COMMON_INFRA,
      ...TOOLS_BASIC,
    ],
    envKeys: ["ANTHROPIC_API_KEY"],
  },

  "local-ollama": {
    name: "local-ollama",
    description: "Fully local with Ollama — no API keys needed",
    components: [
      "cli",
      "agent-ollama",
      "memory-sqlite",
      ...COMMON_INFRA,
      ...TOOLS_BASIC,
      "tool-web-search",
    ],
    envKeys: [],
  },

  "openai-full": {
    name: "openai-full",
    description: "OpenAI GPT with extended dev tools",
    components: [
      "cli",
      "agent-openai",
      "memory-sqlite",
      ...COMMON_INFRA,
      ...TOOLS_DEV,
      "tool-web-fetch",
      "tool-web-search",
    ],
    envKeys: ["OPENAI_API_KEY"],
  },

  "gemini-starter": {
    name: "gemini-starter",
    description: "Google Gemini with lightweight JSON memory",
    components: [
      "cli",
      "agent-gemini",
      "memory-json",
      ...COMMON_INFRA,
      ...TOOLS_BASIC,
    ],
    envKeys: ["GOOGLE_API_KEY"],
  },

  "deepseek-coder": {
    name: "deepseek-coder",
    description: "DeepSeek optimized for coding tasks",
    components: [
      "cli",
      "agent-deepseek",
      "memory-sqlite",
      ...COMMON_INFRA,
      ...TOOLS_DEV,
      "tool-file-search",
    ],
    envKeys: ["DEEPSEEK_API_KEY"],
  },

  "openrouter-multi": {
    name: "openrouter-multi",
    description: "OpenRouter for access to multiple model providers",
    components: [
      "cli",
      "agent-openrouter",
      "memory-sqlite",
      ...COMMON_INFRA,
      ...TOOLS_BASIC,
      "tool-web-search",
    ],
    envKeys: ["OPENROUTER_API_KEY"],
  },

  "enterprise-aws": {
    name: "enterprise-aws",
    description: "AWS Bedrock agent with PostgreSQL memory",
    components: [
      "cli",
      "agent-bedrock",
      "memory-postgres",
      ...COMMON_INFRA,
      ...TOOLS_BASIC,
      "tool-web-search",
    ],
    envKeys: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
  },

  "webchat-demo": {
    name: "webchat-demo",
    description: "Browser-based chat UI with Anthropic agent",
    components: [
      "webchat",
      "agent-anthropic",
      "memory-sqlite",
      ...COMMON_INFRA,
      ...TOOLS_BASIC,
    ],
    envKeys: ["ANTHROPIC_API_KEY"],
  },

  "webhook-api": {
    name: "webhook-api",
    description: "HTTP webhook endpoint for API integrations",
    components: [
      "webhook",
      "agent-anthropic",
      "memory-sqlite",
      ...COMMON_INFRA,
      ...TOOLS_BASIC,
      "tool-http-request",
    ],
    envKeys: ["ANTHROPIC_API_KEY"],
  },

  "full-stack": {
    name: "full-stack",
    description: "Everything — all 17 tools with hybrid memory",
    components: [
      "cli",
      "agent-anthropic",
      "memory-hybrid-rrf",
      ...COMMON_INFRA,
      ...TOOLS_ALL,
    ],
    envKeys: ["ANTHROPIC_API_KEY"],
  },
};

export const DEFAULT_PRESET = "minimal";

export function getPreset(name: string): Preset | undefined {
  return PRESETS[name];
}

export function listPresets(): Preset[] {
  return Object.values(PRESETS);
}
