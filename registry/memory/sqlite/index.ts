import type { Memory, Message, SearchOptions, SearchResult } from "clawkit:types";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface SqliteMemoryConfig {
  name?: string;
  dbPath?: string;
}

export default function createSqliteMemory(config: SqliteMemoryConfig): Memory {
  const dbPath = config.dbPath ?? "./data/memory.db";
  let db: Database.Database;

  return {
    name: "memory-sqlite",

    async init() {
      mkdirSync(dirname(dbPath), { recursive: true });
      db = new Database(dbPath);
      db.pragma("journal_mode = WAL");

      db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
      `);

      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
          content,
          session_id UNINDEXED,
          message_id UNINDEXED
        );
      `);
    },

    async saveMessages(sessionId: string, messages: Message[]) {
      const insertMsg = db.prepare(
        "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)"
      );
      const insertFts = db.prepare(
        "INSERT INTO messages_fts (content, session_id, message_id) VALUES (?, ?, ?)"
      );

      const transaction = db.transaction((msgs: Message[]) => {
        for (const msg of msgs) {
          const result = insertMsg.run(
            sessionId,
            msg.role,
            msg.content,
            (msg.timestamp ?? new Date()).toISOString()
          );
          if (msg.content.trim()) {
            insertFts.run(msg.content, sessionId, result.lastInsertRowid);
          }
        }
      });

      transaction(messages);
    },

    async loadMessages(sessionId: string, limit = 50): Promise<Message[]> {
      const rows = db.prepare(
        "SELECT role, content, timestamp FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?"
      ).all(sessionId, limit) as { role: string; content: string; timestamp: string }[];

      return rows.reverse().map((r) => ({
        role: r.role as Message["role"],
        content: r.content,
        timestamp: new Date(r.timestamp),
      }));
    },

    async clear(sessionId: string) {
      db.prepare("DELETE FROM messages_fts WHERE session_id = ?").run(sessionId);
      db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
    },

    async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
      const limit = options?.limit ?? 5;
      // Sanitize for FTS5: strip non-alphanumeric, quote each term
      const terms = query.replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean);
      if (terms.length === 0) return [];
      const ftsQuery = terms.map(t => `"${t}"`).join(" OR ");

      let sql = "SELECT content, session_id, rank FROM messages_fts WHERE messages_fts MATCH ?";
      const params: any[] = [ftsQuery];

      if (options?.sessionId) {
        sql += " AND session_id = ?";
        params.push(options.sessionId);
      }

      sql += " ORDER BY rank LIMIT ?";
      params.push(limit);

      const rows = db.prepare(sql).all(...params) as {
        content: string; session_id: string; rank: number;
      }[];

      return rows.map((r) => ({
        content: r.content,
        score: -r.rank, // FTS5 rank is negative (lower = better)
        source: r.session_id,
      }));
    },

    async compact(sessionId: string) {
      const messages = await this.loadMessages(sessionId, 1000);
      if (messages.length <= 20) return;

      const keep = messages.slice(-10);
      await this.clear(sessionId);
      await this.saveMessages(sessionId, [
        { role: "system", content: "[Earlier conversation context was compacted]" },
        ...keep,
      ]);
    },
  };
}
