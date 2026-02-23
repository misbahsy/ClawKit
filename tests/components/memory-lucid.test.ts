import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import createLucidMemory from "../../registry/memory/lucid/index.js";
import type { LucidMemory } from "../../registry/memory/lucid/index.js";

describe("memory-lucid", () => {
  let tmpDir: string;
  let memory: LucidMemory;

  beforeEach(async () => {
    tmpDir = resolve(tmpdir(), `clawkit-lucid-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    memory = createLucidMemory({ dataDir: tmpDir });
    await memory.init();
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should have correct name", () => {
    expect(memory.name).toBe("memory-lucid");
  });

  it("should initialize data directory", async () => {
    expect(existsSync(tmpDir)).toBe(true);
  });

  it("should save and load messages", async () => {
    await memory.saveMessages("sess-1", [
      { role: "user", content: "Hello lucid" },
      { role: "assistant", content: "Lucid memory active" },
    ]);

    const messages = await memory.loadMessages("sess-1");
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe("Hello lucid");
    expect(messages[1].content).toBe("Lucid memory active");
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

  it("should search messages by content", async () => {
    await memory.saveMessages("sess-4", [
      { role: "user", content: "TypeScript programming" },
      { role: "user", content: "Python scripting" },
    ]);

    const results = await memory.search("TypeScript");
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain("TypeScript");
  });

  it("should filter search by sessionId", async () => {
    await memory.saveMessages("sess-5a", [
      { role: "user", content: "Rust is fast" },
    ]);
    await memory.saveMessages("sess-5b", [
      { role: "user", content: "Rust is safe" },
    ]);

    const results = await memory.search("Rust", { sessionId: "sess-5a" });
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe("sess-5a");
  });

  it("should snapshot current state", async () => {
    await memory.saveMessages("sess-6", [
      { role: "user", content: "Snapshot me" },
    ]);

    const snap = memory.snapshot();
    expect(snap.sessions).toBeDefined();
    expect(snap.sessions["sess-6"]).toHaveLength(1);
    expect(snap.sessions["sess-6"][0].content).toBe("Snapshot me");
  });

  it("should hydrate from a snapshot", async () => {
    await memory.saveMessages("sess-7", [
      { role: "user", content: "Before hydrate" },
    ]);

    const snap = memory.snapshot();

    // Clear everything
    await memory.clear("sess-7");
    expect(await memory.loadMessages("sess-7")).toHaveLength(0);

    // Hydrate from snapshot
    memory.hydrate(snap);
    const messages = await memory.loadMessages("sess-7");
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("Before hydrate");
  });

  it("should create a deep copy on snapshot (no shared references)", async () => {
    await memory.saveMessages("sess-8", [
      { role: "user", content: "Original" },
    ]);

    const snap = memory.snapshot();

    // Modify the original memory
    await memory.saveMessages("sess-8", [
      { role: "user", content: "Added after snapshot" },
    ]);

    // Snapshot should not be affected
    expect(snap.sessions["sess-8"]).toHaveLength(1);
    expect(snap.sessions["sess-8"][0].content).toBe("Original");
  });

  it("should persist state to file", async () => {
    await memory.saveMessages("sess-9", [
      { role: "user", content: "Persisted" },
    ]);

    const statePath = resolve(tmpDir, "lucid-state.json");
    expect(existsSync(statePath)).toBe(true);
  });

  it("should restore state on init from file", async () => {
    await memory.saveMessages("sess-10", [
      { role: "user", content: "Restored message" },
    ]);

    const memory2 = createLucidMemory({ dataDir: tmpDir });
    await memory2.init();

    const messages = await memory2.loadMessages("sess-10");
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("Restored message");
  });

  it("should compact messages keeping recent ones", async () => {
    for (let i = 0; i < 25; i++) {
      await memory.saveMessages("sess-11", [
        { role: "user", content: `Message ${i}` },
      ]);
    }

    await memory.compact("sess-11");
    const messages = await memory.loadMessages("sess-11");
    expect(messages).toHaveLength(11);
    expect(messages[0].content).toContain("compacted");
    expect(messages[1].content).toBe("Message 15");
  });

  it("should not compact when 20 or fewer messages", async () => {
    for (let i = 0; i < 15; i++) {
      await memory.saveMessages("sess-12", [
        { role: "user", content: `Message ${i}` },
      ]);
    }

    await memory.compact("sess-12");
    const messages = await memory.loadMessages("sess-12");
    expect(messages).toHaveLength(15);
  });

  it("should isolate sessions", async () => {
    await memory.saveMessages("sess-a", [{ role: "user", content: "A" }]);
    await memory.saveMessages("sess-b", [{ role: "user", content: "B" }]);

    const a = await memory.loadMessages("sess-a");
    const b = await memory.loadMessages("sess-b");
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].content).toBe("A");
    expect(b[0].content).toBe("B");
  });

  it("should hydrate with a completely new state", async () => {
    await memory.saveMessages("sess-old", [
      { role: "user", content: "Old data" },
    ]);

    memory.hydrate({
      sessions: {
        "sess-new": [
          { role: "user", content: "New data", timestamp: new Date().toISOString() },
        ],
      },
      meta: { version: 2 },
    });

    expect(await memory.loadMessages("sess-old")).toHaveLength(0);
    const newMsgs = await memory.loadMessages("sess-new");
    expect(newMsgs).toHaveLength(1);
    expect(newMsgs[0].content).toBe("New data");
  });
});
