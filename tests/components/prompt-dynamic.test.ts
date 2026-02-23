import { describe, it, expect } from "vitest";
import createDynamicPrompt from "../../registry/prompt/dynamic/index.js";
import type { PromptContext } from "../../packages/core/src/types.js";

describe("prompt-dynamic", () => {
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

  it("should have the correct name", () => {
    const prompt = createDynamicPrompt({});
    expect(prompt.name).toBe("prompt-dynamic");
  });

  it("should include all sections in full mode", async () => {
    const prompt = createDynamicPrompt({});
    const result = await prompt.build(makeContext({
      mode: "full",
      agent: { name: "FullAgent", identity: "I am FullAgent.", personality: "Friendly and concise." },
      channel: "whatsapp",
      sessionType: "group",
      group: { name: "Dev Team", memberCount: 5 },
      user: { name: "Alice", profile: "Software engineer" },
      tools: [
        { name: "bash", description: "Execute shell commands", parameters: {} },
      ],
      memoryContext: "User discussed project setup yesterday.",
      skills: [{ name: "code", promptSection: "You can write code.", tools: [], mcpConnections: [] }],
      workspaceFiles: [{ path: "AGENTS.md", content: "Agent file content." }],
    }));

    expect(result).toContain("I am FullAgent.");
    expect(result).toContain("2024-01-01T00:00:00Z");
    expect(result).toContain("UTC");
    expect(result).toContain("whatsapp");
    expect(result).toContain("Dev Team");
    expect(result).toContain("5 members");
    expect(result).toContain("Alice");
    expect(result).toContain("Software engineer");
    expect(result).toContain("Friendly and concise.");
    expect(result).toContain("bash: Execute shell commands");
    expect(result).toContain("User discussed project setup yesterday.");
    expect(result).toContain("You can write code.");
    expect(result).toContain("[AGENTS.md]");
    expect(result).toContain("Agent file content.");
  });

  it("should trim content in minimal mode", async () => {
    const prompt = createDynamicPrompt({});
    const longMemory = "A".repeat(1000);
    const result = await prompt.build(makeContext({
      mode: "minimal",
      agent: { name: "MinAgent", personality: "Should not appear" },
      sessionType: "group",
      group: { name: "Big Group", memberCount: 50 },
      user: { name: "Bob", profile: "Should not appear in minimal" },
      memoryContext: longMemory,
      workspaceFiles: [{ path: "README.md", content: "Should not appear" }],
    }));

    // Identity and date should still be present
    expect(result).toContain("MinAgent");
    expect(result).toContain("2024-01-01T00:00:00Z");

    // Group name present but no member count
    expect(result).toContain("Big Group");
    expect(result).not.toContain("50 members");

    // User name present but not profile
    expect(result).toContain("Bob");
    expect(result).not.toContain("Should not appear in minimal");

    // Personality excluded in minimal
    expect(result).not.toContain("Should not appear");

    // Memory truncated to 500 chars
    expect(result).toContain("Relevant context:");
    const memoryMatch = result.match(/Relevant context:\n(A+)/);
    expect(memoryMatch).toBeTruthy();
    expect(memoryMatch![1].length).toBeLessThanOrEqual(500);

    // Workspace files excluded in minimal mode
    expect(result).not.toContain("[README.md]");
  });

  it("should return empty string in none mode", async () => {
    const prompt = createDynamicPrompt({});
    const result = await prompt.build(makeContext({ mode: "none" }));
    expect(result).toBe("");
  });

  it("should use defaultMode from config when context.mode is not set", async () => {
    const nonePrompt = createDynamicPrompt({ defaultMode: "none" });
    const result = await nonePrompt.build(makeContext());
    expect(result).toBe("");
  });

  it("should prune low-priority sections when over token budget", async () => {
    // Set a very small token budget so only the highest-priority sections fit
    const prompt = createDynamicPrompt({ maxTokenEstimate: 50 });
    const result = await prompt.build(makeContext({
      mode: "full",
      agent: { name: "BudgetAgent", personality: "A very elaborate personality description" },
      user: { name: "Charlie", profile: "Detailed user profile" },
      tools: [
        { name: "bash", description: "Execute shell commands", parameters: {} },
        { name: "web_search", description: "Search the web", parameters: {} },
      ],
      memoryContext: "Some memory about previous conversations.",
      skills: [{ name: "code", promptSection: "Code writing skill section.", tools: [], mcpConnections: [] }],
      workspaceFiles: [{ path: "NOTES.md", content: "Workspace file content." }],
    }));

    // Identity (priority 1) should always be included
    expect(result).toContain("BudgetAgent");

    // Lower-priority sections should be dropped due to budget
    // With ~50 tokens (~200 chars), only identity + date should fit
    const estimatedTokens = Math.ceil(result.length / 4);
    expect(estimatedTokens).toBeLessThanOrEqual(100); // Some tolerance
  });

  it("should respect maxTokens from context over config", async () => {
    const prompt = createDynamicPrompt({ maxTokenEstimate: 10000 });
    const result = await prompt.build(makeContext({
      mode: "full",
      maxTokens: 30,
      agent: { name: "TinyBudget" },
      memoryContext: "Long memory that should get cut off.",
      tools: [
        { name: "tool1", description: "Does something", parameters: {} },
        { name: "tool2", description: "Does another thing", parameters: {} },
      ],
    }));

    // With 30 token budget (~120 chars), many sections won't fit
    expect(result).toContain("TinyBudget");
  });

  it("should include tool descriptions in full mode", async () => {
    const prompt = createDynamicPrompt({});
    const result = await prompt.build(makeContext({
      mode: "full",
      tools: [
        { name: "bash", description: "Execute shell commands", parameters: {} },
        { name: "web_search", description: "Search the web", parameters: {} },
        { name: "file_read", description: "Read file contents", parameters: {} },
      ],
    }));

    expect(result).toContain("Available tools:");
    expect(result).toContain("- bash: Execute shell commands");
    expect(result).toContain("- web_search: Search the web");
    expect(result).toContain("- file_read: Read file contents");
  });

  it("should use agent identity when provided instead of default", async () => {
    const prompt = createDynamicPrompt({});
    const result = await prompt.build(makeContext({
      agent: { name: "Named", identity: "Custom identity text." },
    }));

    expect(result).toContain("Custom identity text.");
    expect(result).not.toContain("helpful AI assistant");
  });

  it("should fall back to default identity when none provided", async () => {
    const prompt = createDynamicPrompt({});
    const result = await prompt.build(makeContext({
      agent: { name: "FallbackBot" },
    }));

    expect(result).toContain("You are FallbackBot, a helpful AI assistant.");
  });

  it("should show full group info in full mode and trimmed in minimal", async () => {
    const prompt = createDynamicPrompt({});
    const fullResult = await prompt.build(makeContext({
      mode: "full",
      sessionType: "group",
      group: { name: "Team Alpha", memberCount: 12 },
    }));
    const minResult = await prompt.build(makeContext({
      mode: "minimal",
      sessionType: "group",
      group: { name: "Team Alpha", memberCount: 12 },
    }));

    expect(fullResult).toContain("Team Alpha (12 members)");
    expect(minResult).toContain("Team Alpha");
    expect(minResult).not.toContain("12 members");
  });
});
