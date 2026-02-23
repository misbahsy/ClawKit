import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pg
const mockQuery = vi.fn();
const mockConnect = vi.fn();
const mockRelease = vi.fn();

const mockClient = {
  query: vi.fn(),
  release: mockRelease,
};

vi.mock("pg", () => ({
  default: {
    Pool: vi.fn(() => ({
      query: mockQuery,
      connect: mockConnect,
    })),
  },
  Pool: vi.fn(() => ({
    query: mockQuery,
    connect: mockConnect,
  })),
}));

import createPostgresMemory from "../../registry/memory/postgres/index.js";

describe("memory-postgres", () => {
  let memory: ReturnType<typeof createPostgresMemory>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });
    mockConnect.mockResolvedValue(mockClient);
    mockClient.query.mockResolvedValue({ rows: [] });

    memory = createPostgresMemory({
      connectionString: "postgresql://test:test@localhost/testdb",
      tableName: "test_messages",
    });
  });

  it("should have correct memory name", () => {
    expect(memory.name).toBe("memory-postgres");
  });

  it("should create table on init", async () => {
    await memory.init();

    // Should have called pool.query to create table and indexes
    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect(mockQuery.mock.calls[0][0]).toContain("CREATE TABLE IF NOT EXISTS test_messages");
    expect(mockQuery.mock.calls[1][0]).toContain("CREATE INDEX IF NOT EXISTS");
    expect(mockQuery.mock.calls[2][0]).toContain("CREATE INDEX IF NOT EXISTS");
  });

  it("should save messages in a transaction", async () => {
    await memory.init();

    await memory.saveMessages("session-1", [
      { role: "user", content: "Hello", timestamp: new Date("2025-01-01T00:00:00Z") },
      { role: "assistant", content: "Hi!", timestamp: new Date("2025-01-01T00:00:01Z") },
    ]);

    expect(mockConnect).toHaveBeenCalled();
    expect(mockClient.query).toHaveBeenCalledWith("BEGIN");
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO test_messages"),
      expect.arrayContaining(["session-1", "user", "Hello"]),
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO test_messages"),
      expect.arrayContaining(["session-1", "assistant", "Hi!"]),
    );
    expect(mockClient.query).toHaveBeenCalledWith("COMMIT");
    expect(mockRelease).toHaveBeenCalled();
  });

  it("should rollback on save error", async () => {
    await memory.init();

    mockClient.query.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT")) throw new Error("insert failed");
      return { rows: [] };
    });

    await expect(
      memory.saveMessages("session-1", [{ role: "user", content: "fail" }]),
    ).rejects.toThrow("insert failed");

    expect(mockClient.query).toHaveBeenCalledWith("ROLLBACK");
    expect(mockRelease).toHaveBeenCalled();
  });

  it("should load messages ordered by id desc then reversed", async () => {
    await memory.init();

    mockQuery.mockResolvedValueOnce({
      rows: [
        { role: "assistant", content: "Hi!", timestamp: "2025-01-01T00:00:01Z" },
        { role: "user", content: "Hello", timestamp: "2025-01-01T00:00:00Z" },
      ],
    });

    const messages = await memory.loadMessages("session-1", 10);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("ORDER BY id DESC LIMIT"),
      ["session-1", 10],
    );
    // Should be reversed (oldest first)
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("Hello");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toBe("Hi!");
  });

  it("should clear messages for a session", async () => {
    await memory.init();

    await memory.clear("session-1");

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM test_messages WHERE session_id"),
      ["session-1"],
    );
  });

  it("should search using tsvector FTS", async () => {
    await memory.init();

    mockQuery.mockResolvedValueOnce({
      rows: [
        { content: "TypeScript is great", session_id: "session-1", rank: 0.75 },
        { content: "I love TypeScript", session_id: "session-1", rank: 0.5 },
      ],
    });

    const results = await memory.search("TypeScript", { limit: 5 });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("ts_rank"),
      expect.arrayContaining(["TypeScript"]),
    );
    expect(results).toHaveLength(2);
    expect(results[0].content).toBe("TypeScript is great");
    expect(results[0].score).toBe(0.75);
    expect(results[0].source).toBe("session-1");
  });

  it("should filter search by sessionId", async () => {
    await memory.init();

    mockQuery.mockResolvedValueOnce({ rows: [] });

    await memory.search("test", { sessionId: "session-1", limit: 3 });

    const lastCall = mockQuery.mock.calls[mockQuery.mock.calls.length - 1];
    expect(lastCall[0]).toContain("AND session_id");
    expect(lastCall[1]).toContain("session-1");
  });

  it("should return empty for empty search query", async () => {
    await memory.init();

    const results = await memory.search("   ");
    expect(results).toEqual([]);
  });

  it("should compact old messages keeping recent ones", async () => {
    await memory.init();

    // Mock loadMessages to return 25 messages
    const manyMessages = Array.from({ length: 25 }, (_, i) => ({
      role: "user" as const,
      content: `Message ${i}`,
      timestamp: "2025-01-01T00:00:00Z",
    }));

    mockQuery.mockResolvedValueOnce({ rows: manyMessages.slice().reverse() });

    // Mock clear
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // Mock saveMessages transaction
    mockConnect.mockResolvedValueOnce(mockClient);
    mockClient.query.mockResolvedValue({ rows: [] });

    await memory.compact("session-1");

    // Should have called delete (clear)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("DELETE"),
      ["session-1"],
    );
  });

  it("should not compact when message count is low", async () => {
    await memory.init();

    // Mock loadMessages to return only 5 messages
    mockQuery.mockResolvedValueOnce({
      rows: Array.from({ length: 5 }, (_, i) => ({
        role: "user",
        content: `Message ${i}`,
        timestamp: "2025-01-01T00:00:00Z",
      })),
    });

    const queryCountBefore = mockQuery.mock.calls.length;
    await memory.compact("session-1");

    // Should only have the loadMessages query, not delete
    const queriesAfterCompact = mockQuery.mock.calls.slice(queryCountBefore + 1);
    const deleteQueries = queriesAfterCompact.filter((c: any) =>
      typeof c[0] === "string" && c[0].includes("DELETE"),
    );
    expect(deleteQueries).toHaveLength(0);
  });
});
