import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import createToolBundleSkills from "../../registry/skills/tool-bundle/index.js";

describe("skills-tool-bundle", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "clawkit-tool-bundle-"));

    writeFileSync(
      join(tempDir, "code-tools.json"),
      JSON.stringify({
        name: "code-tools",
        description: "Tools for code analysis and manipulation",
        promptSection: "You have access to code analysis tools.",
        tools: [
          {
            name: "lint",
            description: "Run linter on code",
            parameters: {
              type: "object",
              properties: {
                code: { type: "string" },
                language: { type: "string" },
              },
            },
          },
          {
            name: "format",
            description: "Format code",
            parameters: {
              type: "object",
              properties: {
                code: { type: "string" },
              },
            },
          },
        ],
      }),
    );

    writeFileSync(
      join(tempDir, "search-bundle.json"),
      JSON.stringify({
        name: "search-bundle",
        description: "Web search capabilities",
        tools: [
          {
            name: "web-search",
            description: "Search the web",
            parameters: {},
          },
        ],
      }),
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should have the correct name", () => {
    const manager = createToolBundleSkills({ directories: [tempDir] });
    expect(manager.name).toBe("skills-tool-bundle");
  });

  it("should load bundles from directory", async () => {
    const manager = createToolBundleSkills({ directories: [tempDir] });
    const skills = await manager.loadSkills({});

    expect(skills).toHaveLength(2);
  });

  it("should parse bundle name and type", async () => {
    const manager = createToolBundleSkills({ directories: [tempDir] });
    const skills = await manager.loadSkills({});

    const codeTools = skills.find((s) => s.name === "code-tools");
    expect(codeTools).toBeDefined();
    expect(codeTools!.type).toBe("tool-bundle");
  });

  it("should extract promptSection from bundle", async () => {
    const manager = createToolBundleSkills({ directories: [tempDir] });
    const skills = await manager.loadSkills({});

    const codeTools = skills.find((s) => s.name === "code-tools");
    expect(codeTools!.promptSection).toBe("You have access to code analysis tools.");
  });

  it("should fall back to description when no promptSection", async () => {
    const manager = createToolBundleSkills({ directories: [tempDir] });
    const skills = await manager.loadSkills({});

    const searchBundle = skills.find((s) => s.name === "search-bundle");
    expect(searchBundle!.promptSection).toBe("Web search capabilities");
  });

  it("should namespace tools with bundle name", async () => {
    const manager = createToolBundleSkills({ directories: [tempDir] });
    await manager.loadSkills({});

    const tools = manager.getTools();
    const toolNames = tools.map((t) => t.name);

    expect(toolNames).toContain("code-tools__lint");
    expect(toolNames).toContain("code-tools__format");
    expect(toolNames).toContain("search-bundle__web-search");
  });

  it("should return all tools from all bundles via getTools", async () => {
    const manager = createToolBundleSkills({ directories: [tempDir] });
    await manager.loadSkills({});

    const tools = manager.getTools();
    expect(tools).toHaveLength(3); // 2 from code-tools + 1 from search-bundle
  });

  it("should preserve tool descriptions and parameters", async () => {
    const manager = createToolBundleSkills({ directories: [tempDir] });
    await manager.loadSkills({});

    const tools = manager.getTools();
    const lint = tools.find((t) => t.name === "code-tools__lint");

    expect(lint).toBeDefined();
    expect(lint!.description).toBe("Run linter on code");
    expect(lint!.parameters).toHaveProperty("type", "object");
  });

  it("should return error when executing bundle tools (declarative only)", async () => {
    const manager = createToolBundleSkills({ directories: [tempDir] });
    await manager.loadSkills({});

    const tools = manager.getTools();
    const lint = tools.find((t) => t.name === "code-tools__lint")!;

    const result = await lint.execute({ code: "x=1" }, {
      workspaceDir: "/tmp",
      sessionId: "test",
    });

    expect(result.error).toContain("no runtime implementation");
  });

  it("should return prompt sections for loaded bundles", async () => {
    const manager = createToolBundleSkills({ directories: [tempDir] });
    await manager.loadSkills({});

    const sections = manager.getPromptSections();
    expect(sections.length).toBeGreaterThanOrEqual(2);

    const codeSection = sections.find((s) => s.name === "code-tools");
    expect(codeSection).toBeDefined();
    expect(codeSection!.content).toContain("code analysis tools");
  });

  it("should return empty MCP connections", async () => {
    const manager = createToolBundleSkills({ directories: [tempDir] });
    await manager.loadSkills({});

    expect(manager.getMCPConnections()).toEqual([]);
  });

  it("should handle nonexistent directory", async () => {
    const manager = createToolBundleSkills({
      directories: ["/tmp/nonexistent-clawkit-bundle-xyz"],
    });
    const skills = await manager.loadSkills({});

    expect(skills).toHaveLength(0);
  });

  it("should scan multiple directories", async () => {
    const secondDir = mkdtempSync(join(tmpdir(), "clawkit-tool-bundle2-"));
    writeFileSync(
      join(secondDir, "extra.json"),
      JSON.stringify({
        name: "extra-bundle",
        description: "Extra tools",
        tools: [],
      }),
    );

    const manager = createToolBundleSkills({ directories: [tempDir, secondDir] });
    const skills = await manager.loadSkills({});

    expect(skills).toHaveLength(3);

    rmSync(secondDir, { recursive: true, force: true });
  });

  it("should skip malformed JSON files", async () => {
    writeFileSync(join(tempDir, "bad.json"), "not valid json {{{");

    const manager = createToolBundleSkills({ directories: [tempDir] });
    const skills = await manager.loadSkills({});

    // Should still load the 2 valid bundles
    expect(skills).toHaveLength(2);
  });

  it("should ignore non-.json files", async () => {
    writeFileSync(join(tempDir, "readme.md"), "# Not a bundle");
    writeFileSync(join(tempDir, "notes.txt"), "just notes");

    const manager = createToolBundleSkills({ directories: [tempDir] });
    const skills = await manager.loadSkills({});

    expect(skills).toHaveLength(2);
  });

  it("should use filename as name when bundle has no name", async () => {
    writeFileSync(
      join(tempDir, "unnamed.json"),
      JSON.stringify({
        description: "No name field",
        tools: [],
      }),
    );

    const manager = createToolBundleSkills({ directories: [tempDir] });
    const skills = await manager.loadSkills({});

    const unnamed = skills.find((s) => s.name === "unnamed");
    expect(unnamed).toBeDefined();
  });

  it("should clear previous skills on reload", async () => {
    const manager = createToolBundleSkills({ directories: [tempDir] });

    const first = await manager.loadSkills({});
    expect(first).toHaveLength(2);
    expect(manager.getTools()).toHaveLength(3);

    // Load from empty directory
    const emptyDir = mkdtempSync(join(tmpdir(), "clawkit-empty-bundle-"));
    const manager2 = createToolBundleSkills({ directories: [emptyDir] });
    await manager2.loadSkills({});

    expect(manager2.getTools()).toHaveLength(0);

    rmSync(emptyDir, { recursive: true, force: true });
  });

  it("should return empty sections before loadSkills is called", () => {
    const manager = createToolBundleSkills({ directories: [tempDir] });
    expect(manager.getPromptSections()).toEqual([]);
    expect(manager.getTools()).toEqual([]);
  });

  it("should handle bundle with no tools array", async () => {
    writeFileSync(
      join(tempDir, "no-tools.json"),
      JSON.stringify({
        name: "prompt-only",
        description: "Just a prompt section",
        promptSection: "You are a prompt-only skill.",
      }),
    );

    const manager = createToolBundleSkills({ directories: [tempDir] });
    const skills = await manager.loadSkills({});

    const promptOnly = skills.find((s) => s.name === "prompt-only");
    expect(promptOnly).toBeDefined();
    expect(promptOnly!.tools).toHaveLength(0);
  });
});
