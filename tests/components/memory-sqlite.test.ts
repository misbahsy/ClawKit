import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import createSqliteMemory from "../../registry/memory/sqlite/index.js";

// We need to handle the clawkit:types import. Since we're testing the registry
// file directly, we import the factory and trust the types.

describe("memory-sqlite", () => {
  let tmpDir: string;
  let memory: ReturnType<typeof createSqliteMemory>;

  beforeEach(async () => {
    tmpDir = resolve(tmpdir(), `clawkit-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    memory = createSqliteMemory({ dbPath: resolve(tmpDir, "test.db") });
    await memory.init();
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should initialize database", async () => {
    expect(existsSync(resolve(tmpDir, "test.db"))).toBe(true);
  });

  it("should save and load messages", async () => {
    await memory.saveMessages("session-1", [
      { role: "user", content: "Hello", timestamp: new Date() },
      { role: "assistant", content: "Hi there!", timestamp: new Date() },
    ]);

    const messages = await memory.loadMessages("session-1");
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("Hello");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toBe("Hi there!");
  });

  it("should respect limit when loading messages", async () => {
    for (let i = 0; i < 10; i++) {
      await memory.saveMessages("session-2", [
        { role: "user", content: `Message ${i}` },
      ]);
    }

    const messages = await memory.loadMessages("session-2", 3);
    expect(messages).toHaveLength(3);
    // Should return the last 3 messages
    expect(messages[0].content).toBe("Message 7");
    expect(messages[2].content).toBe("Message 9");
  });

  it("should search with FTS5", async () => {
    await memory.saveMessages("session-3", [
      { role: "user", content: "I love TypeScript programming" },
      { role: "assistant", content: "TypeScript is great for type safety" },
      { role: "user", content: "What about Python?" },
    ]);

    const results = await memory.search("TypeScript");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain("TypeScript");
  });

  it("should clear messages for a session", async () => {
    await memory.saveMessages("session-4", [
      { role: "user", content: "Clear me" },
    ]);

    await memory.clear("session-4");
    const messages = await memory.loadMessages("session-4");
    expect(messages).toHaveLength(0);
  });

  it("should compact messages keeping recent ones", async () => {
    // Add 25 messages
    for (let i = 0; i < 25; i++) {
      await memory.saveMessages("session-5", [
        { role: "user", content: `Message ${i}` },
      ]);
    }

    await memory.compact("session-5");
    const messages = await memory.loadMessages("session-5");
    // Should have system summary + 10 recent messages = 11
    expect(messages).toHaveLength(11);
    expect(messages[0].content).toContain("compacted");
  });

  it("should isolate sessions", async () => {
    await memory.saveMessages("session-a", [
      { role: "user", content: "Session A message" },
    ]);
    await memory.saveMessages("session-b", [
      { role: "user", content: "Session B message" },
    ]);

    const a = await memory.loadMessages("session-a");
    const b = await memory.loadMessages("session-b");
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].content).toBe("Session A message");
    expect(b[0].content).toBe("Session B message");
  });
});
