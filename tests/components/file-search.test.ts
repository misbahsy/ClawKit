import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import createFileSearchTool from "../../registry/tools/file-search/index.js";

describe("tool-file-search", () => {
  let workspaceDir: string;
  const context = { workspaceDir: "", sessionId: "test-session" };

  beforeEach(() => {
    workspaceDir = resolve(tmpdir(), `clawkit-test-${randomUUID()}`);
    mkdirSync(resolve(workspaceDir, "src/components"), { recursive: true });
    mkdirSync(resolve(workspaceDir, "src/utils"), { recursive: true });
    mkdirSync(resolve(workspaceDir, "docs"), { recursive: true });

    writeFileSync(resolve(workspaceDir, "src/index.ts"), "export {}");
    writeFileSync(resolve(workspaceDir, "src/components/Button.tsx"), "export const Button = () => {}");
    writeFileSync(resolve(workspaceDir, "src/components/Modal.tsx"), "export const Modal = () => {}");
    writeFileSync(resolve(workspaceDir, "src/utils/helpers.ts"), "export function help() {}");
    writeFileSync(resolve(workspaceDir, "docs/readme.md"), "# Docs");
    writeFileSync(resolve(workspaceDir, "package.json"), "{}");

    context.workspaceDir = workspaceDir;
  });

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("should have the correct tool interface", () => {
    const tool = createFileSearchTool({});
    expect(tool.name).toBe("file_search");
    expect(tool.description).toBeTruthy();
    expect(tool.parameters.required).toContain("pattern");
    expect(tool.parameters.properties).toHaveProperty("pattern");
    expect(tool.parameters.properties).toHaveProperty("directory");
    expect(tool.parameters.properties).toHaveProperty("regex");
    expect(tool.parameters.properties).toHaveProperty("maxResults");
  });

  it("should find files matching glob pattern *.ts", async () => {
    const tool = createFileSearchTool({});
    const result = await tool.execute({ pattern: "*.ts" }, context);

    expect(result.output).toContain("index.ts");
    expect(result.output).toContain("helpers.ts");
    expect(result.output).not.toContain(".tsx");
  });

  it("should find files matching glob pattern **/*.tsx", async () => {
    const tool = createFileSearchTool({});
    const result = await tool.execute({ pattern: "**/*.tsx" }, context);

    expect(result.output).toContain("Button.tsx");
    expect(result.output).toContain("Modal.tsx");
  });

  it("should search within a subdirectory", async () => {
    const tool = createFileSearchTool({});
    const result = await tool.execute(
      { pattern: "*.tsx", directory: "src/components" },
      context,
    );

    expect(result.output).toContain("Button.tsx");
    expect(result.output).toContain("Modal.tsx");
    expect(result.output).not.toContain("index.ts");
  });

  it("should support regex pattern matching", async () => {
    const tool = createFileSearchTool({});
    const result = await tool.execute(
      { pattern: "\\.(ts|tsx)$", regex: true },
      context,
    );

    expect(result.output).toContain("index.ts");
    expect(result.output).toContain("Button.tsx");
    expect(result.output).not.toContain("readme.md");
  });

  it("should respect maxResults limit", async () => {
    const tool = createFileSearchTool({});
    const result = await tool.execute({ pattern: "*", maxResults: 2 }, context);

    const lines = result.output.split("\n").filter((l) => l && !l.startsWith("..."));
    expect(lines.length).toBeLessThanOrEqual(2);
  });

  it("should return no results message for non-matching pattern", async () => {
    const tool = createFileSearchTool({});
    const result = await tool.execute({ pattern: "*.xyz" }, context);

    expect(result.output).toContain("No files found");
  });

  it("should error on path traversal in directory", async () => {
    const tool = createFileSearchTool({});
    const result = await tool.execute(
      { pattern: "*", directory: "../../etc" },
      context,
    );

    expect(result.error).toContain("within workspace");
  });

  it("should error on invalid regex", async () => {
    const tool = createFileSearchTool({});
    const result = await tool.execute(
      { pattern: "[invalid", regex: true },
      context,
    );

    expect(result.error).toContain("Invalid regex");
  });

  it("should error on nonexistent directory", async () => {
    const tool = createFileSearchTool({});
    const result = await tool.execute(
      { pattern: "*", directory: "nonexistent" },
      context,
    );

    expect(result.error).toContain("not found");
  });

  it("should use config defaultMaxResults", async () => {
    const tool = createFileSearchTool({ defaultMaxResults: 1 });
    const result = await tool.execute({ pattern: "*" }, context);

    const lines = result.output.split("\n").filter((l) => l && !l.startsWith("..."));
    expect(lines.length).toBe(1);
    expect(result.output).toContain("limited to 1");
  });
});
