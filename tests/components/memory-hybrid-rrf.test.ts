import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import createHybridRRFMemory from "../../registry/memory/hybrid-rrf/index.js";

// Mock fetch globally to simulate embedding endpoint.
// Returns empty embeddings so vector search is skipped,
// but FTS5 keyword search works with real SQLite.
const mockFetch = vi.fn().mockResolvedValue({
  ok: false,
  json: async () => ({}),
});
vi.stubGlobal("fetch", mockFetch);

describe("memory-hybrid-rrf", () => {
  let tmpDir: string;
  let memory: ReturnType<typeof createHybridRRFMemory>;

  beforeEach(async () => {
    tmpDir = resolve(tmpdir(), `clawkit-hrrf-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    mockFetch.mockClear();
    // Embedding endpoint returns not-ok so getEmbedding returns []
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({}) });
    memory = createHybridRRFMemory({ dbPath: resolve(tmpDir, "hybrid.db") });
    await memory.init();
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should initialize database", async () => {
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

  it("should search with FTS5 keyword mode", async () => {
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

  it("should compact messages keeping recent ones", async () => {
    for (let i = 0; i < 25; i++) {
      await memory.saveMessages("sess-6", [
        { role: "user", content: `Message ${i}` },
      ]);
    }

    await memory.compact("sess-6");
    const messages = await memory.loadMessages("sess-6");
    // system compaction notice + 10 recent messages = 11
    expect(messages).toHaveLength(11);
    expect(messages[0].content).toContain("compacted");
    expect(messages[1].content).toBe("Message 15");
    expect(messages[10].content).toBe("Message 24");
  });

  it("should not compact when message count is 20 or fewer", async () => {
    for (let i = 0; i < 15; i++) {
      await memory.saveMessages("sess-7", [
        { role: "user", content: `Message ${i}` },
      ]);
    }

    await memory.compact("sess-7");
    const messages = await memory.loadMessages("sess-7");
    expect(messages).toHaveLength(15);
  });

  it("should isolate sessions", async () => {
    await memory.saveMessages("sess-a", [
      { role: "user", content: "Session A message" },
    ]);
    await memory.saveMessages("sess-b", [
      { role: "user", content: "Session B message" },
    ]);

    const a = await memory.loadMessages("sess-a");
    const b = await memory.loadMessages("sess-b");
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].content).toBe("Session A message");
    expect(b[0].content).toBe("Session B message");
  });

  it("should call embedding endpoint on save", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: [0.1, 0.2, 0.3] }),
    });

    await memory.saveMessages("sess-8", [
      { role: "user", content: "Embedding test" },
    ]);

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/embeddings",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("Embedding test"),
      })
    );
  });

  it("should return empty results for empty query terms", async () => {
    await memory.saveMessages("sess-9", [
      { role: "user", content: "Some content" },
    ]);

    const results = await memory.search("!!!@@@", { mode: "keyword" });
    expect(results).toHaveLength(0);
  });
});
