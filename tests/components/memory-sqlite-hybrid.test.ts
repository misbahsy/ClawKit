import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import createSqliteHybridMemory from "../../registry/memory/sqlite-hybrid/index.js";

// Mock fetch globally to simulate embedding endpoint.
const mockFetch = vi.fn().mockResolvedValue({
  ok: false,
  json: async () => ({}),
});
vi.stubGlobal("fetch", mockFetch);

describe("memory-sqlite-hybrid", () => {
  let tmpDir: string;
  let memory: ReturnType<typeof createSqliteHybridMemory>;

  beforeEach(async () => {
    tmpDir = resolve(tmpdir(), `clawkit-shm-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({}) });
    memory = createSqliteHybridMemory({
      dbPath: resolve(tmpDir, "hybrid.db"),
      weightBM25: 0.6,
      weightVector: 0.4,
    });
    await memory.init();
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should have correct name", () => {
    expect(memory.name).toBe("memory-sqlite-hybrid");
  });

  it("should initialize database file", async () => {
    expect(existsSync(resolve(tmpDir, "hybrid.db"))).toBe(true);
  });

  it("should save and load messages", async () => {
    await memory.saveMessages("sess-1", [
      { role: "user", content: "Hello world", timestamp: new Date() },
      { role: "assistant", content: "Hi there!", timestamp: new Date() },
    ]);

    const messages = await memory.loadMessages("sess-1");
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("Hello world");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toBe("Hi there!");
  });

  it("should respect limit when loading messages", async () => {
    for (let i = 0; i < 10; i++) {
      await memory.saveMessages("sess-2", [
        { role: "user", content: `Message ${i}` },
      ]);
    }

    const messages = await memory.loadMessages("sess-2", 3);
    expect(messages).toHaveLength(3);
    expect(messages[0].content).toBe("Message 7");
    expect(messages[2].content).toBe("Message 9");
  });

  it("should clear messages for a session", async () => {
    await memory.saveMessages("sess-3", [
      { role: "user", content: "Clear me" },
    ]);

    await memory.clear("sess-3");
    const messages = await memory.loadMessages("sess-3");
    expect(messages).toHaveLength(0);
  });

  it("should search with FTS5 keyword mode using BM25", async () => {
    await memory.saveMessages("sess-4", [
      { role: "user", content: "I love TypeScript programming" },
      { role: "assistant", content: "TypeScript is great for type safety" },
      { role: "user", content: "What about Python?" },
    ]);

    const results = await memory.search("TypeScript", { mode: "keyword" });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain("TypeScript");
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("should filter keyword search by sessionId", async () => {
    await memory.saveMessages("sess-5a", [
      { role: "user", content: "Rust is fast" },
    ]);
    await memory.saveMessages("sess-5b", [
      { role: "user", content: "Rust is memory safe" },
    ]);

    const results = await memory.search("Rust", { mode: "keyword", sessionId: "sess-5a" });
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe("sess-5a");
  });

  it("should perform hybrid search with weighted scoring", async () => {
    // With embeddings unavailable, hybrid falls back to BM25-only with weight
    await memory.saveMessages("sess-6", [
      { role: "user", content: "Machine learning is fascinating" },
      { role: "assistant", content: "Deep learning is a subset of machine learning" },
    ]);

    const results = await memory.search("machine learning", { mode: "hybrid" });
    expect(results.length).toBeGreaterThan(0);
    // Score should be weighted: weightBM25 * normalizedBM25 + weightVector * 0 (no embeddings)
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("should call embedding endpoint on save", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: [0.1, 0.2, 0.3] }),
    });

    await memory.saveMessages("sess-7", [
      { role: "user", content: "Embedding test" },
    ]);

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/embeddings",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("Embedding test"),
      }),
    );
  });

  it("should compact messages keeping recent ones", async () => {
    for (let i = 0; i < 25; i++) {
      await memory.saveMessages("sess-8", [
        { role: "user", content: `Message ${i}` },
      ]);
    }

    await memory.compact("sess-8");
    const messages = await memory.loadMessages("sess-8");
    expect(messages).toHaveLength(11);
    expect(messages[0].content).toContain("compacted");
    expect(messages[1].content).toBe("Message 15");
    expect(messages[10].content).toBe("Message 24");
  });

  it("should not compact when message count is 20 or fewer", async () => {
    for (let i = 0; i < 15; i++) {
      await memory.saveMessages("sess-9", [
        { role: "user", content: `Message ${i}` },
      ]);
    }

    await memory.compact("sess-9");
    const messages = await memory.loadMessages("sess-9");
    expect(messages).toHaveLength(15);
  });

  it("should isolate sessions", async () => {
    await memory.saveMessages("sess-a", [
      { role: "user", content: "Session A" },
    ]);
    await memory.saveMessages("sess-b", [
      { role: "user", content: "Session B" },
    ]);

    const a = await memory.loadMessages("sess-a");
    const b = await memory.loadMessages("sess-b");
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].content).toBe("Session A");
    expect(b[0].content).toBe("Session B");
  });

  it("should return empty results for empty query terms", async () => {
    await memory.saveMessages("sess-c", [
      { role: "user", content: "Some content" },
    ]);

    const results = await memory.search("!!!@@@", { mode: "keyword" });
    expect(results).toHaveLength(0);
  });

  it("should use custom weights in config", () => {
    const custom = createSqliteHybridMemory({
      dbPath: resolve(tmpDir, "custom.db"),
      weightBM25: 0.8,
      weightVector: 0.2,
    });
    expect(custom.name).toBe("memory-sqlite-hybrid");
  });
});
