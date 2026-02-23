import { describe, it, expect, vi, beforeEach } from "vitest";
import { spawnSync } from "node:child_process";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

import createQmdSearchTool from "../../registry/tools/qmd-search/index.js";

describe("tool-qmd-search", () => {
  const context = { workspaceDir: ".", sessionId: "test-session" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have the correct tool interface", () => {
    const tool = createQmdSearchTool({});
    expect(tool.name).toBe("qmd_search");
    expect(tool.description).toBeTruthy();
    expect(tool.parameters.required).toContain("query");
    expect(tool.parameters.properties).toHaveProperty("collection");
    expect(tool.parameters.properties).toHaveProperty("limit");
  });

  it("should execute qmd query with basic args", async () => {
    (spawnSync as any).mockReturnValue({
      status: 0,
      stdout: "Result 1: Some document\nResult 2: Another doc",
      stderr: "",
      error: null,
    });

    const tool = createQmdSearchTool({});
    const result = await tool.execute({ query: "how to deploy" }, context);

    expect(spawnSync).toHaveBeenCalledWith(
      "qmd",
      ["query", "how to deploy"],
      expect.objectContaining({ encoding: "utf-8" }),
    );
    expect(result.output).toContain("Result 1");
    expect(result.output).toContain("Result 2");
  });

  it("should pass collection filter", async () => {
    (spawnSync as any).mockReturnValue({
      status: 0,
      stdout: "Filtered result",
      stderr: "",
      error: null,
    });

    const tool = createQmdSearchTool({});
    await tool.execute({ query: "test", collection: "notes" }, context);

    expect(spawnSync).toHaveBeenCalledWith(
      "qmd",
      ["query", "test", "--collection", "notes"],
      expect.anything(),
    );
  });

  it("should pass limit parameter", async () => {
    (spawnSync as any).mockReturnValue({
      status: 0,
      stdout: "Result",
      stderr: "",
      error: null,
    });

    const tool = createQmdSearchTool({});
    await tool.execute({ query: "test", limit: 5 }, context);

    expect(spawnSync).toHaveBeenCalledWith(
      "qmd",
      ["query", "test", "--limit", "5"],
      expect.anything(),
    );
  });

  it("should use custom qmdPath from config", async () => {
    (spawnSync as any).mockReturnValue({
      status: 0,
      stdout: "Result",
      stderr: "",
      error: null,
    });

    const tool = createQmdSearchTool({ qmdPath: "/usr/local/bin/qmd" });
    await tool.execute({ query: "test" }, context);

    expect(spawnSync).toHaveBeenCalledWith(
      "/usr/local/bin/qmd",
      expect.anything(),
      expect.anything(),
    );
  });

  it("should handle ENOENT when qmd is not installed", async () => {
    (spawnSync as any).mockReturnValue({
      status: null,
      stdout: "",
      stderr: "",
      error: Object.assign(new Error("spawn qmd ENOENT"), { code: "ENOENT" }),
    });

    const tool = createQmdSearchTool({});
    const result = await tool.execute({ query: "test" }, context);

    expect(result.error).toContain("QMD CLI not found");
  });

  it("should handle non-zero exit code", async () => {
    (spawnSync as any).mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "Unknown collection",
      error: null,
    });

    const tool = createQmdSearchTool({});
    const result = await tool.execute(
      { query: "test", collection: "nonexistent" },
      context,
    );

    expect(result.error).toContain("exited with code 1");
    expect(result.error).toContain("Unknown collection");
  });

  it("should handle empty results", async () => {
    (spawnSync as any).mockReturnValue({
      status: 0,
      stdout: "",
      stderr: "",
      error: null,
    });

    const tool = createQmdSearchTool({});
    const result = await tool.execute({ query: "nothing matches" }, context);

    expect(result.output).toContain("No results found");
  });

  it("should include metadata in successful results", async () => {
    (spawnSync as any).mockReturnValue({
      status: 0,
      stdout: "Some result",
      stderr: "",
      error: null,
    });

    const tool = createQmdSearchTool({});
    const result = await tool.execute(
      { query: "deploy guide", collection: "docs" },
      context,
    );

    expect(result.metadata).toEqual({
      collection: "docs",
      query: "deploy guide",
    });
  });
});
