import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRun, mockGet, mockAll, mockExec, mockPragma, mockPrepare, mockDatabase } = vi.hoisted(() => {
  const mockRun = vi.fn();
  const mockGet = vi.fn();
  const mockAll = vi.fn(() => []);
  const mockExec = vi.fn();
  const mockPragma = vi.fn();
  const mockPrepare = vi.fn(() => ({
    run: mockRun,
    get: mockGet,
    all: mockAll,
  }));
  const mockDatabase = vi.fn(() => ({
    exec: mockExec,
    pragma: mockPragma,
    prepare: mockPrepare,
  }));
  return { mockRun, mockGet, mockAll, mockExec, mockPragma, mockPrepare, mockDatabase };
});

vi.mock("better-sqlite3", () => ({
  default: mockDatabase,
}));

import createPersistentQueue from "../../registry/queue/persistent/index.js";
import type { QueuedMessage } from "../../packages/core/src/types.js";

function makeMessage(sessionId: string, content: string): QueuedMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    sessionId,
    message: {
      id: `msg-${Date.now()}`,
      channel: "test",
      sender: "user1",
      content,
      timestamp: new Date(),
      raw: null,
    },
    enqueuedAt: new Date(),
  };
}

describe("queue-persistent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAll.mockReturnValue([]);
    mockGet.mockReturnValue({ count: 0 });
  });

  it("should have correct name", () => {
    const queue = createPersistentQueue({});
    expect(queue.name).toBe("queue-persistent");
  });

  it("should create SQLite table on initialization", () => {
    createPersistentQueue({});
    expect(mockExec).toHaveBeenCalled();

    const execCalls = mockExec.mock.calls.map((c: any) => c[0]).join(" ");
    expect(execCalls).toContain("CREATE TABLE IF NOT EXISTS queue");
  });

  it("should enable WAL mode", () => {
    createPersistentQueue({});
    expect(mockPragma).toHaveBeenCalledWith("journal_mode = WAL");
  });

  it("should create indexes", () => {
    createPersistentQueue({});
    const execCalls = mockExec.mock.calls.map((c: any) => c[0]).join(" ");
    expect(execCalls).toContain("idx_queue_status");
    expect(execCalls).toContain("idx_queue_session");
  });

  it("should enqueue messages to SQLite", async () => {
    const queue = createPersistentQueue({});
    const msg = makeMessage("s1", "hello");

    await queue.enqueue("s1", msg);

    expect(mockRun).toHaveBeenCalledWith(
      msg.id,
      "s1",
      expect.any(String),
      0,
      0,
      3,
    );

    // Verify the serialized message
    const serialized = mockRun.mock.calls[0][2];
    const parsed = JSON.parse(serialized);
    expect(parsed.content).toBe("hello");
  });

  it("should use custom dbPath", () => {
    createPersistentQueue({ dbPath: "/tmp/custom-queue.db" });
    expect(mockDatabase).toHaveBeenCalledWith("/tmp/custom-queue.db");
  });

  it("should use custom maxRetries", async () => {
    const queue = createPersistentQueue({ maxRetries: 5 });
    const msg = makeMessage("s1", "hello");

    await queue.enqueue("s1", msg);

    // maxRetries is used as max_attempts
    expect(mockRun).toHaveBeenCalledWith(
      msg.id,
      "s1",
      expect.any(String),
      0,
      0,
      5,
    );
  });

  it("should process handler picks up pending messages", async () => {
    const rows = [{
      id: "msg-1",
      session_id: "s1",
      message: JSON.stringify({
        id: "msg-1",
        channel: "test",
        sender: "user1",
        content: "hello",
        timestamp: new Date().toISOString(),
        raw: null,
      }),
      priority: 0,
      attempts: 0,
      max_attempts: 3,
      status: "pending",
      created_at: new Date().toISOString(),
    }];

    // First call returns rows, subsequent calls return empty
    let fetchCallCount = 0;
    mockAll.mockImplementation(() => {
      fetchCallCount++;
      return fetchCallCount === 1 ? rows : [];
    });

    const handler = vi.fn();
    const queue = createPersistentQueue({});
    queue.process(handler);

    // Wait for poll to pick up the message
    await new Promise((r) => setTimeout(r, 300));

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "s1" }),
    );

    mockGet.mockReturnValue({ count: 0 });
    await queue.drain();
  });

  it("should report queue length from database", async () => {
    mockGet.mockReturnValue({ count: 5 });

    const queue = createPersistentQueue({});
    const len = await queue.getQueueLength();
    expect(len).toBe(5);
  });

  it("should report queue length by session", async () => {
    mockGet.mockReturnValue({ count: 2 });

    const queue = createPersistentQueue({});
    const len = await queue.getQueueLength("s1");
    expect(len).toBe(2);
  });

  it("should allow concurrency to be changed", () => {
    const queue = createPersistentQueue({ concurrency: 1 });
    expect(() => queue.setConcurrency(5)).not.toThrow();
  });

  it("should use default dbPath when not configured", () => {
    createPersistentQueue({});
    expect(mockDatabase).toHaveBeenCalledWith(".clawkit/queue.db");
  });

  it("should drain and clean up done messages", async () => {
    mockGet.mockReturnValue({ count: 0 });

    const queue = createPersistentQueue({});
    await queue.drain();

    // Should call cleanup (DELETE WHERE status = 'done')
    expect(mockRun).toHaveBeenCalled();
  });
});
