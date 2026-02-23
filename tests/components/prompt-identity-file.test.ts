import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import createIdentityFilePrompt from "../../registry/prompt/identity-file/index.js";
import type { PromptContext } from "../../packages/core/src/types.js";

function makeContext(overrides?: Partial<PromptContext>): PromptContext {
  return {
    agent: { name: "TestBot" },
    dateTime: "2025-01-15T10:00:00Z",
    timezone: "UTC",
    channel: "test",
    sessionType: "dm",
    tools: [],
    skills: [],
    ...overrides,
  };
}

describe("prompt-identity-file", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "clawkit-identity-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should have the correct name", () => {
    const builder = createIdentityFilePrompt({});
    expect(builder.name).toBe("prompt-identity-file");
  });

  it("should load identity from JSON file", async () => {
    const identityPath = join(tempDir, "identity.json");
    writeFileSync(
      identityPath,
      JSON.stringify({
        name: "Atlas",
        personality: "Curious and helpful",
        traits: ["analytical", "empathetic", "concise"],
        communicationStyle: "Formal but warm",
        moralAlignment: "Lawful Good",
      }),
    );

    const builder = createIdentityFilePrompt({ identityFile: identityPath });
    const prompt = await builder.build(makeContext());

    expect(prompt).toContain("You are Atlas.");
    expect(prompt).toContain("Curious and helpful");
    expect(prompt).toContain("analytical, empathetic, concise");
    expect(prompt).toContain("Formal but warm");
    expect(prompt).toContain("Lawful Good");
  });

  it("should load identity from markdown file", async () => {
    const identityPath = join(tempDir, "identity.md");
    writeFileSync(
      identityPath,
      `# Atlas

You are Atlas, a curious assistant who loves exploring ideas.

## Communication Style
- Be formal but warm
- Use analogies when explaining`,
    );

    const builder = createIdentityFilePrompt({ identityFile: identityPath });
    const prompt = await builder.build(makeContext());

    expect(prompt).toContain("# Atlas");
    expect(prompt).toContain("curious assistant who loves exploring ideas");
    expect(prompt).toContain("Use analogies when explaining");
  });

  it("should include JSON instructions field", async () => {
    const identityPath = join(tempDir, "identity.json");
    writeFileSync(
      identityPath,
      JSON.stringify({
        name: "Helper",
        instructions: "Always be kind and provide sources.",
      }),
    );

    const builder = createIdentityFilePrompt({ identityFile: identityPath });
    const prompt = await builder.build(makeContext());

    expect(prompt).toContain("You are Helper.");
    expect(prompt).toContain("Always be kind and provide sources.");
  });

  it("should fallback to context agent name when no file", async () => {
    const builder = createIdentityFilePrompt({});
    const prompt = await builder.build(makeContext({ agent: { name: "Fallback" } }));

    expect(prompt).toContain("You are Fallback.");
  });

  it("should fallback to context agent name when file not found", async () => {
    const builder = createIdentityFilePrompt({
      identityFile: "/tmp/nonexistent-identity-xyz.json",
    });
    const prompt = await builder.build(makeContext({ agent: { name: "Missing" } }));

    expect(prompt).toContain("You are Missing.");
  });

  it("should fallback on malformed JSON file", async () => {
    const identityPath = join(tempDir, "bad.json");
    writeFileSync(identityPath, "not valid json {{{");

    const builder = createIdentityFilePrompt({ identityFile: identityPath });
    const prompt = await builder.build(makeContext({ agent: { name: "FallbackBot" } }));

    expect(prompt).toContain("You are FallbackBot.");
  });

  it("should include runtime context (date, timezone, channel)", async () => {
    const builder = createIdentityFilePrompt({});
    const prompt = await builder.build(makeContext());

    expect(prompt).toContain("2025-01-15T10:00:00Z");
    expect(prompt).toContain("UTC");
    expect(prompt).toContain("Channel: test (dm)");
  });

  it("should include user name when provided", async () => {
    const builder = createIdentityFilePrompt({});
    const prompt = await builder.build(makeContext({ user: { name: "Alice" } }));

    expect(prompt).toContain("User: Alice");
  });

  it("should include tools when provided", async () => {
    const builder = createIdentityFilePrompt({});
    const prompt = await builder.build(
      makeContext({
        tools: [
          { name: "search", description: "Search the web", parameters: {} },
          { name: "calc", description: "Calculate math", parameters: {} },
        ],
      }),
    );

    expect(prompt).toContain("Available tools:");
    expect(prompt).toContain("- search: Search the web");
    expect(prompt).toContain("- calc: Calculate math");
  });

  it("should include memory context when provided", async () => {
    const builder = createIdentityFilePrompt({});
    const prompt = await builder.build(
      makeContext({ memoryContext: "User previously asked about cats." }),
    );

    expect(prompt).toContain("Relevant context from memory:");
    expect(prompt).toContain("User previously asked about cats.");
  });

  it("should include skill prompt sections", async () => {
    const builder = createIdentityFilePrompt({});
    const prompt = await builder.build(
      makeContext({
        skills: [
          { name: "code-review", type: "markdown", promptSection: "You can review code." },
        ],
      }),
    );

    expect(prompt).toContain("You can review code.");
  });

  it("should include personality from context when no file", async () => {
    const builder = createIdentityFilePrompt({});
    const prompt = await builder.build(
      makeContext({ agent: { name: "Bot", personality: "Cheerful and witty" } }),
    );

    expect(prompt).toContain("You are Bot.");
    expect(prompt).toContain("Personality: Cheerful and witty");
  });

  it("should cache identity file content for same path", async () => {
    const identityPath = join(tempDir, "cached.json");
    writeFileSync(identityPath, JSON.stringify({ name: "CachedBot" }));

    const builder = createIdentityFilePrompt({ identityFile: identityPath });

    const prompt1 = await builder.build(makeContext());
    const prompt2 = await builder.build(makeContext());

    expect(prompt1).toContain("CachedBot");
    expect(prompt2).toContain("CachedBot");
  });
});
