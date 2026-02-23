import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import createWorkspacePrompt from "../../registry/prompt/workspace/index.js";
import type { PromptContext } from "../../packages/core/src/types.js";

describe("prompt-workspace", () => {
  let workspaceDir: string;

  function makeContext(overrides: Partial<PromptContext> = {}): PromptContext {
    return {
      agent: { name: "TestAgent" },
      dateTime: "2024-01-01T00:00:00Z",
      timezone: "UTC",
      channel: "cli",
      sessionType: "dm",
      tools: [],
      skills: [],
      ...overrides,
    };
  }

  beforeEach(() => {
    workspaceDir = resolve(tmpdir(), `clawkit-ws-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(workspaceDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("should create prompt builder with correct name", () => {
    const prompt = createWorkspacePrompt({ workspaceDir });
    expect(prompt.name).toBe("prompt-workspace");
  });

  it("should include AGENTS.md content when present", async () => {
    writeFileSync(resolve(workspaceDir, "AGENTS.md"), "You are Jarvis, a personal assistant.");
    const prompt = createWorkspacePrompt({ workspaceDir });
    const result = await prompt.build(makeContext());

    expect(result).toContain("You are Jarvis, a personal assistant.");
  });

  it("should fall back to agent name when AGENTS.md is missing", async () => {
    const prompt = createWorkspacePrompt({ workspaceDir });
    const result = await prompt.build(makeContext({ agent: { name: "FallbackAgent" } }));

    expect(result).toContain("FallbackAgent");
    expect(result).toContain("helpful AI assistant");
  });

  it("should include SOUL.md content when present", async () => {
    writeFileSync(resolve(workspaceDir, "SOUL.md"), "Be concise and friendly.");
    const prompt = createWorkspacePrompt({ workspaceDir });
    const result = await prompt.build(makeContext());

    expect(result).toContain("Be concise and friendly.");
  });

  it("should include TOOLS.md content when present", async () => {
    writeFileSync(resolve(workspaceDir, "TOOLS.md"), "Use bash for system tasks.");
    const prompt = createWorkspacePrompt({ workspaceDir });
    const result = await prompt.build(makeContext());

    expect(result).toContain("Use bash for system tasks.");
  });

  it("should include USER.md content when present", async () => {
    writeFileSync(resolve(workspaceDir, "USER.md"), "User prefers short answers.");
    const prompt = createWorkspacePrompt({ workspaceDir });
    const result = await prompt.build(makeContext());

    expect(result).toContain("User prefers short answers.");
  });

  it("should include all workspace files together", async () => {
    writeFileSync(resolve(workspaceDir, "AGENTS.md"), "Agent identity here.");
    writeFileSync(resolve(workspaceDir, "SOUL.md"), "Soul content here.");
    writeFileSync(resolve(workspaceDir, "TOOLS.md"), "Tool guidance here.");
    writeFileSync(resolve(workspaceDir, "USER.md"), "User prefs here.");

    const prompt = createWorkspacePrompt({ workspaceDir });
    const result = await prompt.build(makeContext());

    expect(result).toContain("Agent identity here.");
    expect(result).toContain("Soul content here.");
    expect(result).toContain("Tool guidance here.");
    expect(result).toContain("User prefs here.");
  });

  it("should include runtime context (datetime, channel, user)", async () => {
    const prompt = createWorkspacePrompt({ workspaceDir });
    const result = await prompt.build(makeContext({
      dateTime: "2024-06-15T12:00:00Z",
      channel: "whatsapp",
      user: { name: "Alice" },
    }));

    expect(result).toContain("2024-06-15T12:00:00Z");
    expect(result).toContain("whatsapp");
    expect(result).toContain("Alice");
  });

  it("should include tool descriptions", async () => {
    const prompt = createWorkspacePrompt({ workspaceDir });
    const result = await prompt.build(makeContext({
      tools: [
        { name: "bash", description: "Execute shell commands", parameters: {} },
        { name: "web_search", description: "Search the web", parameters: {} },
      ],
    }));

    expect(result).toContain("bash: Execute shell commands");
    expect(result).toContain("web_search: Search the web");
  });

  it("should include memory context when provided", async () => {
    const prompt = createWorkspacePrompt({ workspaceDir });
    const result = await prompt.build(makeContext({
      memoryContext: "User asked about weather yesterday.",
    }));

    expect(result).toContain("User asked about weather yesterday.");
  });

  it("should use cached content on second read (same mtime)", async () => {
    writeFileSync(resolve(workspaceDir, "AGENTS.md"), "Initial content.");
    const prompt = createWorkspacePrompt({ workspaceDir });

    const result1 = await prompt.build(makeContext());
    const result2 = await prompt.build(makeContext());

    expect(result1).toContain("Initial content.");
    expect(result2).toContain("Initial content.");
  });
});
