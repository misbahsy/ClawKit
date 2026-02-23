import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import createQMDMemory from "../../registry/memory/qmd/index.js";

// These tests run in fallback mode since the qmd binary is not available.

describe("memory-qmd (fallback mode)", () => {
  let tmpDir: string;
  let memory: ReturnType<typeof createQMDMemory>;

  beforeEach(async () => {
    tmpDir = resolve(tmpdir(), `clawkit-qmd-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    memory = createQMDMemory({ dataDir: tmpDir, collection: "test" });
    await memory.init();
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should initialize and create data directory", async () => {
    expect(existsSync(tmpDir)).toBe(true);
  });

  it("should save messages to fallback JSON", async () => {
    await memory.saveMessages("sess-1", [
      { role: "user", content: "Hello from QMD fallback" },
      { role: "assistant", content: "Hi there!" },
    ]);

    const fallbackPath = resolve(tmpDir, "fallback.json");
    expect(existsSync(fallbackPath)).toBe(true);

    const data = JSON.parse(readFileSync(fallbackPath, "utf-8"));
    expect(data["sess-1"]).toHaveLength(2);
    expect(data["sess-1"][0].content).toBe("Hello from QMD fallback");
  });

  it("should load messages from fallback", async () => {
    await memory.saveMessages("sess-2", [
      { role: "user", content: "First message" },
      { role: "assistant", content: "Second message" },
    ]);

    const messages = await memory.loadMessages("sess-2");
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("First message");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toBe("Second message");
  });

  it("should respect limit when loading messages", async () => {
    const msgs = Array.from({ length: 10 }, (_, i) => ({
      role: "user" as const,
      content: `Message ${i}`,
    }));
    await memory.saveMessages("sess-3", msgs);

    const loaded = await memory.loadMessages("sess-3", 3);
    expect(loaded).toHaveLength(3);
    expect(loaded[0].content).toBe("Message 7");
    expect(loaded[2].content).toBe("Message 9");
  });

  it("should search messages in fallback mode", async () => {
    await memory.saveMessages("sess-4", [
      { role: "user", content: "TypeScript is awesome" },
      { role: "assistant", content: "I agree, TypeScript rocks" },
      { role: "user", content: "What about Python?" },
    ]);

    const results = await memory.search("TypeScript");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.content.toLowerCase().includes("typescript"))).toBe(true);
  });

  it("should filter search by sessionId", async () => {
    await memory.saveMessages("sess-5a", [
      { role: "user", content: "Rust language" },
    ]);
    await memory.saveMessages("sess-5b", [
      { role: "user", content: "Rust programming" },
    ]);

    const results = await memory.search("Rust", { sessionId: "sess-5a" });
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe("sess-5a");
  });

  it("should clear messages for a session", async () => {
    await memory.saveMessages("sess-6", [
      { role: "user", content: "Clear me" },
    ]);
    await memory.saveMessages("sess-other", [
      { role: "user", content: "Keep me" },
    ]);

    await memory.clear("sess-6");

    const cleared = await memory.loadMessages("sess-6");
    expect(cleared).toHaveLength(0);

    // Other session should be untouched
    const kept = await memory.loadMessages("sess-other");
    expect(kept).toHaveLength(1);
    expect(kept[0].content).toBe("Keep me");
  });

  it("should compact messages keeping recent ones", async () => {
    const msgs = Array.from({ length: 25 }, (_, i) => ({
      role: "user" as const,
      content: `Message ${i}`,
    }));
    await memory.saveMessages("sess-7", msgs);

    await memory.compact("sess-7");
    const loaded = await memory.loadMessages("sess-7");
    // system compaction notice + 10 recent = 11
    expect(loaded).toHaveLength(11);
    expect(loaded[0].content).toContain("compacted");
    expect(loaded[1].content).toBe("Message 15");
    expect(loaded[10].content).toBe("Message 24");
  });

  it("should not compact when message count is 20 or fewer", async () => {
    const msgs = Array.from({ length: 15 }, (_, i) => ({
      role: "user" as const,
      content: `Message ${i}`,
    }));
    await memory.saveMessages("sess-8", msgs);

    await memory.compact("sess-8");
    const loaded = await memory.loadMessages("sess-8");
    expect(loaded).toHaveLength(15);
  });

  it("should return empty for non-existent session", async () => {
    const messages = await memory.loadMessages("does-not-exist");
    expect(messages).toHaveLength(0);
  });

  it("should persist fallback data to disk and reload", async () => {
    await memory.saveMessages("sess-9", [
      { role: "user", content: "Persisted message" },
    ]);

    // Create a new instance pointing to the same directory
    const memory2 = createQMDMemory({ dataDir: tmpDir, collection: "test" });
    await memory2.init();

    const loaded = await memory2.loadMessages("sess-9");
    expect(loaded).toHaveLength(1);
    expect(loaded[0].content).toBe("Persisted message");
  });

  it("should respect search limit", async () => {
    const msgs = Array.from({ length: 20 }, (_, i) => ({
      role: "user" as const,
      content: `Searchable item ${i}`,
    }));
    await memory.saveMessages("sess-10", msgs);

    const results = await memory.search("Searchable", { limit: 3 });
    expect(results).toHaveLength(3);
  });
});
