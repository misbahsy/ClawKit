import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import createJsonMemory from "../../registry/memory/json/index.js";

describe("memory-json", () => {
  let tmpDir: string;
  let memory: ReturnType<typeof createJsonMemory>;

  beforeEach(async () => {
    tmpDir = resolve(tmpdir(), `clawkit-test-json-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    memory = createJsonMemory({ sessionDir: resolve(tmpDir, "sessions") });
    await memory.init();
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should initialize session directory", () => {
    expect(existsSync(resolve(tmpDir, "sessions"))).toBe(true);
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

  it("should persist as JSON file", async () => {
    await memory.saveMessages("test-session", [
      { role: "user", content: "Test message" },
    ]);

    const filePath = resolve(tmpDir, "sessions", "test-session.json");
    expect(existsSync(filePath)).toBe(true);

    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(data.messages).toHaveLength(1);
    expect(data.messages[0].content).toBe("Test message");
  });

  it("should respect limit when loading messages", async () => {
    for (let i = 0; i < 10; i++) {
      await memory.saveMessages("session-2", [
        { role: "user", content: `Message ${i}` },
      ]);
    }

    const messages = await memory.loadMessages("session-2", 3);
    expect(messages).toHaveLength(3);
    expect(messages[0].content).toBe("Message 7");
    expect(messages[2].content).toBe("Message 9");
  });

  it("should search across sessions with substring matching", async () => {
    await memory.saveMessages("session-a", [
      { role: "user", content: "I love TypeScript programming" },
    ]);
    await memory.saveMessages("session-b", [
      { role: "user", content: "Python is also great" },
    ]);

    const results = await memory.search("TypeScript");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain("TypeScript");
  });

  it("should clear messages for a session", async () => {
    await memory.saveMessages("session-3", [
      { role: "user", content: "Clear me" },
    ]);

    await memory.clear("session-3");
    const messages = await memory.loadMessages("session-3");
    expect(messages).toHaveLength(0);
  });

  it("should compact messages keeping recent ones", async () => {
    for (let i = 0; i < 25; i++) {
      await memory.saveMessages("session-4", [
        { role: "user", content: `Message ${i}` },
      ]);
    }

    await memory.compact("session-4");
    const messages = await memory.loadMessages("session-4");
    expect(messages).toHaveLength(11); // system + 10 recent
    expect(messages[0].content).toContain("compacted");
  });

  it("should isolate sessions", async () => {
    await memory.saveMessages("session-x", [
      { role: "user", content: "Session X" },
    ]);
    await memory.saveMessages("session-y", [
      { role: "user", content: "Session Y" },
    ]);

    const x = await memory.loadMessages("session-x");
    const y = await memory.loadMessages("session-y");
    expect(x).toHaveLength(1);
    expect(y).toHaveLength(1);
    expect(x[0].content).toBe("Session X");
    expect(y[0].content).toBe("Session Y");
  });
});
