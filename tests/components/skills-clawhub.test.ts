import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import createClawHubSkills from "../../registry/skills/clawhub/index.js";

describe("skills-clawhub", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "clawhub-test-"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should have the correct name", () => {
    const manager = createClawHubSkills({ skillsDir: tempDir });
    expect(manager.name).toBe("skills-clawhub");
  });

  it("should load local skills from directory", async () => {
    const skillContent = [
      "---",
      "name: git-helper",
      "description: Helps with git commands",
      "---",
      "You are a git expert. Help with git operations.",
    ].join("\n");

    writeFileSync(join(tempDir, "git-helper.md"), skillContent, "utf-8");

    const manager = createClawHubSkills({ skillsDir: tempDir });
    const skills = await manager.loadSkills({});

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("git-helper");
    expect(skills[0].type).toBe("markdown");
    expect(skills[0].promptSection).toBe("You are a git expert. Help with git operations.");
  });

  it("should use filename as skill name when frontmatter has no name", async () => {
    writeFileSync(join(tempDir, "fallback-skill.md"), "Just a plain skill body.", "utf-8");

    const manager = createClawHubSkills({ skillsDir: tempDir });
    const skills = await manager.loadSkills({});

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("fallback-skill");
    expect(skills[0].promptSection).toBe("Just a plain skill body.");
  });

  it("should handle missing directory gracefully", async () => {
    const nonExistent = join(tempDir, "does-not-exist");

    const manager = createClawHubSkills({ skillsDir: nonExistent });
    const skills = await manager.loadSkills({});

    expect(skills).toHaveLength(0);
  });

  it("should only load .md files from directory", async () => {
    writeFileSync(join(tempDir, "valid.md"), "Valid skill content.", "utf-8");
    writeFileSync(join(tempDir, "ignored.txt"), "Not a skill.", "utf-8");
    writeFileSync(join(tempDir, "also-ignored.json"), "{}", "utf-8");

    const manager = createClawHubSkills({ skillsDir: tempDir });
    const skills = await manager.loadSkills({});

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("valid");
  });

  it("should install skill from registry via fetch", async () => {
    const installDir = join(tempDir, "installed-skills");
    const mockResponse = {
      name: "code-review",
      content: "---\nname: code-review\n---\nReview code carefully.",
      requires: { bins: [], env: [] },
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockResponse),
    });
    vi.stubGlobal("fetch", fetchMock);

    const manager = createClawHubSkills({
      skillsDir: installDir,
      registryUrl: "https://clawhub.test/api/v1",
    });

    await manager.install("code-review");

    // Verify fetch was called with correct URL
    expect(fetchMock).toHaveBeenCalledWith("https://clawhub.test/api/v1/skills/code-review");

    // Verify file was written
    const savedPath = resolve(installDir, "code-review.md");
    expect(existsSync(savedPath)).toBe(true);

    const savedContent = readFileSync(savedPath, "utf-8");
    expect(savedContent).toBe(mockResponse.content);
  });

  it("should throw on failed fetch during install", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });
    vi.stubGlobal("fetch", fetchMock);

    const manager = createClawHubSkills({
      skillsDir: join(tempDir, "skills"),
      registryUrl: "https://clawhub.test/api/v1",
    });

    await expect(manager.install("nonexistent-skill")).rejects.toThrow(
      'Failed to fetch skill "nonexistent-skill" from ClawHub: 404 Not Found'
    );
  });

  it("should save skill file to skillsDir during install", async () => {
    const installDir = join(tempDir, "deep", "nested", "skills");
    const mockResponse = {
      name: "my-skill",
      content: "Skill body content here.",
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockResponse),
    }));

    const manager = createClawHubSkills({ skillsDir: installDir });
    await manager.install("my-skill");

    const savedPath = resolve(installDir, "my-skill.md");
    expect(existsSync(savedPath)).toBe(true);
    expect(readFileSync(savedPath, "utf-8")).toBe("Skill body content here.");
  });

  it("should return prompt sections for loaded skills", async () => {
    const skill1 = "---\nname: alpha\n---\nAlpha instructions.";
    const skill2 = "---\nname: beta\n---\nBeta instructions.";

    writeFileSync(join(tempDir, "alpha.md"), skill1, "utf-8");
    writeFileSync(join(tempDir, "beta.md"), skill2, "utf-8");

    const manager = createClawHubSkills({ skillsDir: tempDir });
    await manager.loadSkills({});

    const sections = manager.getPromptSections();
    expect(sections).toHaveLength(2);

    const names = sections.map(s => s.name);
    expect(names).toContain("alpha");
    expect(names).toContain("beta");

    const alphaSection = sections.find(s => s.name === "alpha");
    expect(alphaSection!.content).toBe("Alpha instructions.");
  });

  it("should return empty array from getTools", async () => {
    const manager = createClawHubSkills({ skillsDir: tempDir });
    await manager.loadSkills({});

    expect(manager.getTools()).toEqual([]);
  });

  it("should return empty array from getMCPConnections", async () => {
    const manager = createClawHubSkills({ skillsDir: tempDir });
    await manager.loadSkills({});

    expect(manager.getMCPConnections()).toEqual([]);
  });

  it("should clear previous skills on reload", async () => {
    writeFileSync(join(tempDir, "first.md"), "---\nname: first\n---\nFirst skill.", "utf-8");

    const manager = createClawHubSkills({ skillsDir: tempDir });

    const initial = await manager.loadSkills({});
    expect(initial).toHaveLength(1);
    expect(manager.getPromptSections()).toHaveLength(1);

    // Remove file and reload with empty dir
    rmSync(join(tempDir, "first.md"));

    const reloaded = await manager.loadSkills({});
    expect(reloaded).toHaveLength(0);
    expect(manager.getPromptSections()).toHaveLength(0);
  });

  it("should load multiple skills from directory", async () => {
    writeFileSync(join(tempDir, "a.md"), "---\nname: skill-a\n---\nBody A.", "utf-8");
    writeFileSync(join(tempDir, "b.md"), "---\nname: skill-b\n---\nBody B.", "utf-8");
    writeFileSync(join(tempDir, "c.md"), "---\nname: skill-c\n---\nBody C.", "utf-8");

    const manager = createClawHubSkills({ skillsDir: tempDir });
    const skills = await manager.loadSkills({});

    expect(skills).toHaveLength(3);
    const names = skills.map(s => s.name).sort();
    expect(names).toEqual(["skill-a", "skill-b", "skill-c"]);
  });
});
