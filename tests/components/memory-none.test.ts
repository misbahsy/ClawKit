import { describe, it, expect, beforeEach } from "vitest";
import createNoneMemory from "../../registry/memory/none/index.js";
import type { Message } from "../../packages/core/src/types.js";

function makeMessage(role: Message["role"], content: string): Message {
  return { role, content, timestamp: new Date() };
}

describe("memory-none", () => {
  let memory: ReturnType<typeof createNoneMemory>;

  beforeEach(async () => {
    memory = createNoneMemory({});
    await memory.init();
  });

  it("should have the correct name", () => {
    expect(memory.name).toBe("memory-none");
  });

  it("should init without errors", async () => {
    const fresh = createNoneMemory({});
    await expect(fresh.init()).resolves.toBeUndefined();
  });

  it("should save and load messages", async () => {
    await memory.saveMessages("session-1", [
      makeMessage("user", "Hello"),
      makeMessage("assistant", "Hi there"),
    ]);

    const loaded = await memory.loadMessages("session-1");
    expect(loaded).toHaveLength(2);
    expect(loaded[0].content).toBe("Hello");
    expect(loaded[1].content).toBe("Hi there");
  });

  it("should append messages on subsequent saves", async () => {
    await memory.saveMessages("s1", [makeMessage("user", "first")]);
    await memory.saveMessages("s1", [makeMessage("user", "second")]);

    const loaded = await memory.loadMessages("s1");
    expect(loaded).toHaveLength(2);
    expect(loaded[0].content).toBe("first");
    expect(loaded[1].content).toBe("second");
  });

  it("should respect load limit", async () => {
    const messages = Array.from({ length: 20 }, (_, i) =>
      makeMessage("user", `msg-${i}`),
    );
    await memory.saveMessages("s1", messages);

    const loaded = await memory.loadMessages("s1", 5);
    expect(loaded).toHaveLength(5);
    // Should return the last 5 messages
    expect(loaded[0].content).toBe("msg-15");
    expect(loaded[4].content).toBe("msg-19");
  });

  it("should default limit to 50", async () => {
    const messages = Array.from({ length: 60 }, (_, i) =>
      makeMessage("user", `msg-${i}`),
    );
    await memory.saveMessages("s1", messages);

    const loaded = await memory.loadMessages("s1");
    expect(loaded).toHaveLength(50);
  });

  it("should isolate sessions", async () => {
    await memory.saveMessages("a", [makeMessage("user", "session-a")]);
    await memory.saveMessages("b", [makeMessage("user", "session-b")]);

    const loadedA = await memory.loadMessages("a");
    const loadedB = await memory.loadMessages("b");

    expect(loadedA).toHaveLength(1);
    expect(loadedA[0].content).toBe("session-a");
    expect(loadedB).toHaveLength(1);
    expect(loadedB[0].content).toBe("session-b");
  });

  it("should clear a session", async () => {
    await memory.saveMessages("s1", [makeMessage("user", "hello")]);
    await memory.clear("s1");

    const loaded = await memory.loadMessages("s1");
    expect(loaded).toHaveLength(0);
  });

  it("should not affect other sessions when clearing", async () => {
    await memory.saveMessages("s1", [makeMessage("user", "a")]);
    await memory.saveMessages("s2", [makeMessage("user", "b")]);
    await memory.clear("s1");

    const loadedS1 = await memory.loadMessages("s1");
    const loadedS2 = await memory.loadMessages("s2");
    expect(loadedS1).toHaveLength(0);
    expect(loadedS2).toHaveLength(1);
  });

  it("should always return empty from search", async () => {
    await memory.saveMessages("s1", [makeMessage("user", "searchable content")]);

    const results = await memory.search("searchable");
    expect(results).toEqual([]);
  });

  it("should return empty from search with options", async () => {
    const results = await memory.search("anything", { sessionId: "s1", limit: 10 });
    expect(results).toEqual([]);
  });

  it("should compact messages when over 20", async () => {
    const messages = Array.from({ length: 25 }, (_, i) =>
      makeMessage("user", `msg-${i}`),
    );
    await memory.saveMessages("s1", messages);

    await memory.compact("s1");

    const loaded = await memory.loadMessages("s1", 100);
    expect(loaded).toHaveLength(10);
    // Should keep the last 10
    expect(loaded[0].content).toBe("msg-15");
    expect(loaded[9].content).toBe("msg-24");
  });

  it("should not compact when 20 or fewer messages", async () => {
    const messages = Array.from({ length: 15 }, (_, i) =>
      makeMessage("user", `msg-${i}`),
    );
    await memory.saveMessages("s1", messages);

    await memory.compact("s1");

    const loaded = await memory.loadMessages("s1", 100);
    expect(loaded).toHaveLength(15);
  });

  it("should handle loading from nonexistent session", async () => {
    const loaded = await memory.loadMessages("nonexistent");
    expect(loaded).toEqual([]);
  });

  it("should handle clearing nonexistent session", async () => {
    await expect(memory.clear("nonexistent")).resolves.toBeUndefined();
  });
});
