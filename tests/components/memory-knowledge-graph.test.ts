import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import createKnowledgeGraphMemory from "../../registry/memory/knowledge-graph/index.js";

describe("memory-knowledge-graph", () => {
  let tmpDir: string;
  let memory: ReturnType<typeof createKnowledgeGraphMemory>;

  beforeEach(async () => {
    tmpDir = resolve(tmpdir(), `clawkit-kg-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    memory = createKnowledgeGraphMemory({ dataDir: tmpDir });
    await memory.init();
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should have correct name", () => {
    expect(memory.name).toBe("memory-knowledge-graph");
  });

  it("should initialize data directory", async () => {
    expect(existsSync(tmpDir)).toBe(true);
  });

  it("should save and load messages", async () => {
    await memory.saveMessages("sess-1", [
      { role: "user", content: "Hello knowledge graph" },
      { role: "assistant", content: "Knowledge graphs are powerful" },
    ]);

    const messages = await memory.loadMessages("sess-1");
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe("Hello knowledge graph");
    expect(messages[1].content).toBe("Knowledge graphs are powerful");
  });

  it("should extract entities from 'X is a Y' patterns", async () => {
    await memory.saveMessages("sess-2", [
      { role: "user", content: "TypeScript is a language" },
    ]);

    const results = await memory.search("TypeScript");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain("TypeScript");
    expect(results[0].content).toContain("language");
  });

  it("should extract relationships from verb patterns", async () => {
    await memory.saveMessages("sess-3", [
      { role: "user", content: "Alice works at Acme" },
    ]);

    const results = await memory.search("Alice");
    expect(results.length).toBeGreaterThan(0);
    const entityResult = results.find((r) => r.content.includes("Entity:"));
    expect(entityResult).toBeDefined();
    expect(entityResult!.content).toContain("works at");
    expect(entityResult!.content).toContain("Acme");
  });

  it("should search by relationship type", async () => {
    await memory.saveMessages("sess-4", [
      { role: "user", content: "Bob lives in Paris" },
    ]);

    const results = await memory.search("lives in");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain("Bob");
    expect(results[0].content).toContain("Paris");
  });

  it("should fall back to message content search", async () => {
    await memory.saveMessages("sess-5", [
      { role: "user", content: "this is a lowercase message about testing" },
    ]);

    const results = await memory.search("testing");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain("testing");
  });

  it("should filter search by sessionId", async () => {
    await memory.saveMessages("sess-6a", [
      { role: "user", content: "Charlie works at Google" },
    ]);
    await memory.saveMessages("sess-6b", [
      { role: "user", content: "Dana works at Apple" },
    ]);

    const results = await memory.search("works at", { sessionId: "sess-6a" });
    const hasApple = results.some((r) => r.content.includes("Apple"));
    expect(hasApple).toBe(false);
  });

  it("should persist graph to JSON file", async () => {
    await memory.saveMessages("sess-7", [
      { role: "user", content: "Eve created Redis" },
    ]);

    const graphPath = resolve(tmpDir, "graph.json");
    expect(existsSync(graphPath)).toBe(true);
    const data = JSON.parse(readFileSync(graphPath, "utf-8"));
    expect(data.nodes.length).toBeGreaterThan(0);
  });

  it("should restore state from persisted file on init", async () => {
    await memory.saveMessages("sess-8", [
      { role: "user", content: "Frank uses TypeScript" },
    ]);

    const memory2 = createKnowledgeGraphMemory({ dataDir: tmpDir });
    await memory2.init();

    const messages = await memory2.loadMessages("sess-8");
    expect(messages).toHaveLength(1);

    const results = await memory2.search("Frank");
    expect(results.length).toBeGreaterThan(0);
  });

  it("should clear session messages and graph entries", async () => {
    await memory.saveMessages("sess-9", [
      { role: "user", content: "Grace manages Kubernetes" },
    ]);

    await memory.clear("sess-9");
    const messages = await memory.loadMessages("sess-9");
    expect(messages).toHaveLength(0);

    // Nodes for this session should also be cleared
    const results = await memory.search("Grace");
    const fromSess9 = results.filter((r) => r.source === "sess-9");
    expect(fromSess9).toHaveLength(0);
  });

  it("should compact messages keeping recent ones", async () => {
    for (let i = 0; i < 25; i++) {
      await memory.saveMessages("sess-10", [
        { role: "user", content: `Message ${i}` },
      ]);
    }

    await memory.compact("sess-10");
    const messages = await memory.loadMessages("sess-10");
    expect(messages).toHaveLength(11);
    expect(messages[0].content).toContain("compacted");
  });

  it("should not compact when 20 or fewer messages", async () => {
    for (let i = 0; i < 15; i++) {
      await memory.saveMessages("sess-11", [
        { role: "user", content: `Message ${i}` },
      ]);
    }

    await memory.compact("sess-11");
    const messages = await memory.loadMessages("sess-11");
    expect(messages).toHaveLength(15);
  });

  it("should not create duplicate nodes for same entity", async () => {
    await memory.saveMessages("sess-12", [
      { role: "user", content: "TypeScript is a language" },
      { role: "user", content: "TypeScript is a superset" },
    ]);

    // Search for TypeScript should find entity results
    const results = await memory.search("TypeScript");
    const entityResults = results.filter((r) => r.content.startsWith("Entity:"));
    // There should be exactly one entity node for TypeScript (updated type)
    expect(entityResults).toHaveLength(1);
  });

  it("should respect limit on search results", async () => {
    for (let i = 0; i < 20; i++) {
      await memory.saveMessages("sess-13", [
        { role: "user", content: `Topic number ${i} about search` },
      ]);
    }

    const results = await memory.search("search", { limit: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });
});
