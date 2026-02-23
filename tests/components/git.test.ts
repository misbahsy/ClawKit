import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import createGitTool from "../../registry/tools/git/index.js";

describe("tool-git", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "clawkit-git-"));
    execSync("git init", { cwd: tmpDir });
    execSync("git config user.email 'test@test.com'", { cwd: tmpDir });
    execSync("git config user.name 'Test'", { cwd: tmpDir });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const context = (dir: string) => ({ workspaceDir: dir, sessionId: "test-session" });

  it("should create a tool with correct interface", () => {
    const tool = createGitTool({});
    expect(tool.name).toBe("git");
    expect(tool.description).toBeTruthy();
    expect(tool.parameters.required).toContain("operation");
    expect(tool.parameters.properties.operation.enum).toContain("status");
    expect(tool.parameters.properties.operation.enum).toContain("commit");
  });

  it("should run git status", async () => {
    const tool = createGitTool({});
    const result = await tool.execute({ operation: "status" }, context(tmpDir));
    // New repo should show something about branch
    expect(result.output).toBeTruthy();
  });

  it("should run git log on empty repo and return error", async () => {
    const tool = createGitTool({});
    const result = await tool.execute({ operation: "log" }, context(tmpDir));
    // Empty repo has no commits, git log fails
    expect(result.error || result.output).toBeTruthy();
  });

  it("should commit with a message", async () => {
    writeFileSync(join(tmpDir, "file.txt"), "content");
    execSync("git add .", { cwd: tmpDir });

    const tool = createGitTool({});
    const result = await tool.execute(
      { operation: "commit", message: "Initial commit" },
      context(tmpDir),
    );

    expect(result.output).toContain("Initial commit");
  });

  it("should error on commit without message", async () => {
    const tool = createGitTool({});
    const result = await tool.execute({ operation: "commit" }, context(tmpDir));
    expect(result.error).toContain("Commit requires a message");
  });

  it("should run git diff", async () => {
    writeFileSync(join(tmpDir, "file.txt"), "initial");
    execSync("git add . && git commit -m 'init'", { cwd: tmpDir });
    writeFileSync(join(tmpDir, "file.txt"), "modified");

    const tool = createGitTool({});
    const result = await tool.execute({ operation: "diff" }, context(tmpDir));
    expect(result.output).toContain("modified");
  });

  it("should pass additional args", async () => {
    writeFileSync(join(tmpDir, "a.txt"), "a");
    const tool = createGitTool({});
    const result = await tool.execute(
      { operation: "add", args: "a.txt" },
      context(tmpDir),
    );
    expect(result.error).toBeUndefined();
  });
});
