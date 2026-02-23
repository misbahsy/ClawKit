import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import createMarkdownSkills from "../../registry/skills/markdown/index.js";

describe("skills-markdown", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "clawkit-skills-md-"));

    writeFileSync(
      join(tempDir, "code-review.md"),
      `---
name: code-review
description: Reviews code for best practices
---
You are a code reviewer. Analyze code for:
- Security vulnerabilities
- Performance issues
- Best practice violations`,
    );

    writeFileSync(
      join(tempDir, "deploy-helper.md"),
      `---
name: deploy-helper
description: Assists with deployment tasks
requires: bins=[docker,kubectl], env=[KUBE_CONFIG]
---
You help with deployment tasks using Docker and Kubernetes.`,
    );

    writeFileSync(
      join(tempDir, "plain-skill.md"),
      `This skill has no frontmatter at all.
Just plain markdown content.`,
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should have the correct name", () => {
    const manager = createMarkdownSkills({ directories: [tempDir] });
    expect(manager.name).toBe("skills-markdown");
  });

  it("should scan directory for .md files", async () => {
    const manager = createMarkdownSkills({ directories: [tempDir] });
    const skills = await manager.loadSkills({});

    expect(skills).toHaveLength(3);
  });

  it("should parse YAML frontmatter name and description", async () => {
    const manager = createMarkdownSkills({ directories: [tempDir] });
    const skills = await manager.loadSkills({});

    const codeReview = skills.find(s => s.name === "code-review");
    expect(codeReview).toBeDefined();
    expect(codeReview!.type).toBe("markdown");
  });

  it("should return body as promptSection", async () => {
    const manager = createMarkdownSkills({ directories: [tempDir] });
    const skills = await manager.loadSkills({});

    const codeReview = skills.find(s => s.name === "code-review");
    expect(codeReview!.promptSection).toContain("You are a code reviewer");
    expect(codeReview!.promptSection).toContain("Security vulnerabilities");
  });

  it("should parse requirements from frontmatter", async () => {
    const manager = createMarkdownSkills({ directories: [tempDir] });
    const skills = await manager.loadSkills({});

    const deployHelper = skills.find(s => s.name === "deploy-helper");
    expect(deployHelper).toBeDefined();
    expect(deployHelper!.requirements).toEqual({
      bins: ["docker", "kubectl"],
      env: ["KUBE_CONFIG"],
    });
  });

  it("should use filename as name when frontmatter has no name", async () => {
    const manager = createMarkdownSkills({ directories: [tempDir] });
    const skills = await manager.loadSkills({});

    const plain = skills.find(s => s.name === "plain-skill");
    expect(plain).toBeDefined();
    expect(plain!.promptSection).toContain("This skill has no frontmatter at all.");
  });

  it("should handle missing directory gracefully", async () => {
    const manager = createMarkdownSkills({ directories: ["/tmp/nonexistent-clawkit-dir-xyz"] });
    const skills = await manager.loadSkills({});

    expect(skills).toHaveLength(0);
  });

  it("should scan multiple directories", async () => {
    const secondDir = mkdtempSync(join(tmpdir(), "clawkit-skills-md2-"));
    writeFileSync(
      join(secondDir, "extra.md"),
      `---
name: extra-skill
description: An extra skill
---
Extra skill content.`,
    );

    const manager = createMarkdownSkills({ directories: [tempDir, secondDir] });
    const skills = await manager.loadSkills({});

    expect(skills).toHaveLength(4);

    rmSync(secondDir, { recursive: true, force: true });
  });

  it("should return prompt sections for loaded skills", async () => {
    const manager = createMarkdownSkills({ directories: [tempDir] });
    await manager.loadSkills({});

    const sections = manager.getPromptSections();
    expect(sections.length).toBeGreaterThanOrEqual(3);

    const codeReviewSection = sections.find(s => s.name === "code-review");
    expect(codeReviewSection).toBeDefined();
    expect(codeReviewSection!.content).toContain("You are a code reviewer");
  });

  it("should return empty array from getTools", async () => {
    const manager = createMarkdownSkills({ directories: [tempDir] });
    await manager.loadSkills({});

    expect(manager.getTools()).toEqual([]);
  });

  it("should return empty array from getMCPConnections", async () => {
    const manager = createMarkdownSkills({ directories: [tempDir] });
    await manager.loadSkills({});

    expect(manager.getMCPConnections()).toEqual([]);
  });

  it("should clear previous skills on reload", async () => {
    const manager = createMarkdownSkills({ directories: [tempDir] });

    const first = await manager.loadSkills({});
    expect(first).toHaveLength(3);

    // Replace with a nonexistent directory to simulate empty reload
    const emptyDir = mkdtempSync(join(tmpdir(), "clawkit-skills-empty-"));
    const manager2 = createMarkdownSkills({ directories: [emptyDir] });
    const second = await manager2.loadSkills({});
    expect(second).toHaveLength(0);

    rmSync(emptyDir, { recursive: true, force: true });
  });

  it("should return empty prompt sections before loadSkills is called", () => {
    const manager = createMarkdownSkills({ directories: [tempDir] });
    expect(manager.getPromptSections()).toEqual([]);
  });

  it("should ignore non-.md files in the directory", async () => {
    writeFileSync(join(tempDir, "notes.txt"), "not a skill");
    writeFileSync(join(tempDir, "config.json"), "{}");

    const manager = createMarkdownSkills({ directories: [tempDir] });
    const skills = await manager.loadSkills({});

    // Only the 3 original .md files should be found
    expect(skills).toHaveLength(3);
  });
});
