import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import createFileEditTool from "../../registry/tools/file-edit/index.js";

describe("tool-file-edit", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "clawkit-file-edit-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const context = (dir: string) => ({ workspaceDir: dir, sessionId: "test-session" });

  it("should create a tool with correct interface", () => {
    const tool = createFileEditTool({});
    expect(tool.name).toBe("file_edit");
    expect(tool.description).toBeTruthy();
    expect(tool.parameters.required).toEqual(["path", "old_string", "new_string"]);
    expect(tool.parameters.properties).toHaveProperty("path");
    expect(tool.parameters.properties).toHaveProperty("old_string");
    expect(tool.parameters.properties).toHaveProperty("new_string");
  });

  it("should replace a unique string in a file", async () => {
    writeFileSync(join(tmpDir, "test.txt"), "Hello world, this is a test.");
    const tool = createFileEditTool({});
    const result = await tool.execute(
      { path: "test.txt", old_string: "Hello world", new_string: "Goodbye world" },
      context(tmpDir),
    );

    expect(result.output).toContain("Edited test.txt");
    expect(result.output).toContain("replaced 1 occurrence");
    const content = readFileSync(join(tmpDir, "test.txt"), "utf-8");
    expect(content).toBe("Goodbye world, this is a test.");
  });

  it("should error when string is not found", async () => {
    writeFileSync(join(tmpDir, "test.txt"), "Hello world.");
    const tool = createFileEditTool({});
    const result = await tool.execute(
      { path: "test.txt", old_string: "nonexistent", new_string: "replacement" },
      context(tmpDir),
    );

    expect(result.error).toContain("String not found");
  });

  it("should error when string appears multiple times", async () => {
    writeFileSync(join(tmpDir, "test.txt"), "foo bar foo baz foo");
    const tool = createFileEditTool({});
    const result = await tool.execute(
      { path: "test.txt", old_string: "foo", new_string: "qux" },
      context(tmpDir),
    );

    expect(result.error).toContain("3 times");
    expect(result.error).toContain("must be unique");
  });

  it("should error on path traversal", async () => {
    const tool = createFileEditTool({});
    const result = await tool.execute(
      { path: "../../../etc/passwd", old_string: "root", new_string: "hacked" },
      context(tmpDir),
    );

    expect(result.error).toContain("Path traversal denied");
  });

  it("should error when file does not exist", async () => {
    const tool = createFileEditTool({});
    const result = await tool.execute(
      { path: "missing.txt", old_string: "a", new_string: "b" },
      context(tmpDir),
    );

    expect(result.error).toBeTruthy();
  });
});
