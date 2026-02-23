import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import createVectorMemory from "../../registry/memory/vector/index.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("memory-vector", () => {
  let tmpDir: string;
  let memory: ReturnType<typeof createVectorMemory>;

  beforeEach(async () => {
    tmpDir = resolve(tmpdir(), `clawkit-vec-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    mockFetch.mockClear();
    // Default: embeddings unavailable
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({}) });
    memory = createVectorMemory({
      dataDir: tmpDir,
      embeddingEndpoint: "http://localhost:11434/api/embed",
      embeddingModel: "nomic-embed-text",
    });
    await memory.init();
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should have correct name", () => {
    expect(memory.name).toBe("memory-vector");
  });

  it("should initialize data directory", async () => {
    expect(existsSync(tmpDir)).toBe(true);
  });

  it("should save and load messages", async () => {
    await memory.saveMessages("sess-1", [
      { role: "user", content: "Hello vector world" },
      { role: "assistant", content: "Vectors are cool" },
    ]);

    const messages = await memory.loadMessages("sess-1");
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("Hello vector world");
    expect(messages[1].content).toBe("Vectors are cool");
  });

  it("should persist data to JSON file", async () => {
    await memory.saveMessages("sess-2", [
      { role: "user", content: "Persist me" },
    ]);

    const filePath = resolve(tmpDir, "vectors.json");
    expect(existsSync(filePath)).toBe(true);
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(data).toHaveLength(1);
    expect(data[0].content).toBe("Persist me");
  });

  it("should restore from persisted file on init", async () => {
    await memory.saveMessages("sess-3", [
      { role: "user", content: "Restored message" },
    ]);

    // Create new instance pointing to same dir
    const memory2 = createVectorMemory({ dataDir: tmpDir });
    await memory2.init();

    const messages = await memory2.loadMessages("sess-3");
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("Restored message");
  });

  it("should respect limit when loading messages", async () => {
    for (let i = 0; i < 10; i++) {
      await memory.saveMessages("sess-4", [
        { role: "user", content: `Message ${i}` },
      ]);
    }

    const messages = await memory.loadMessages("sess-4", 3);
    expect(messages).toHaveLength(3);
    expect(messages[0].content).toBe("Message 7");
    expect(messages[2].content).toBe("Message 9");
  });

  it("should clear messages for a session", async () => {
    await memory.saveMessages("sess-5", [
      { role: "user", content: "Clear me" },
    ]);

    await memory.clear("sess-5");
    const messages = await memory.loadMessages("sess-5");
    expect(messages).toHaveLength(0);
  });

  it("should fall back to substring search when embeddings unavailable", async () => {
    await memory.saveMessages("sess-6", [
      { role: "user", content: "TypeScript is great" },
      { role: "user", content: "Python is also nice" },
    ]);

    const results = await memory.search("TypeScript");
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain("TypeScript");
  });

  it("should perform vector search when embeddings available", async () => {
    // Save with embeddings
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
    });

    await memory.saveMessages("sess-7", [
      { role: "user", content: "Machine learning" },
    ]);

    // Search with embeddings
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
    });

    const results = await memory.search("ML", { sessionId: "sess-7" });
    expect(results).toHaveLength(1);
    expect(results[0].score).toBeCloseTo(1.0, 5); // identical vectors
  });

  it("should filter search by sessionId", async () => {
    await memory.saveMessages("sess-8a", [
      { role: "user", content: "Rust programming" },
    ]);
    await memory.saveMessages("sess-8b", [
      { role: "user", content: "Rust language" },
    ]);

    const results = await memory.search("Rust", { sessionId: "sess-8a" });
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe("sess-8a");
  });

  it("should call embedding endpoint with correct payload", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [[0.5, 0.5]] }),
    });

    await memory.saveMessages("sess-9", [
      { role: "user", content: "Embed this" },
    ]);

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/embed",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("Embed this"),
      }),
    );
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
    expect(messages[1].content).toBe("Message 15");
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

  it("should isolate sessions", async () => {
    await memory.saveMessages("sess-a", [{ role: "user", content: "A" }]);
    await memory.saveMessages("sess-b", [{ role: "user", content: "B" }]);

    expect(await memory.loadMessages("sess-a")).toHaveLength(1);
    expect(await memory.loadMessages("sess-b")).toHaveLength(1);
  });
});
