import type { Memory, Message, SearchOptions, SearchResult } from "clawkit:types";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface HybridRRFMemoryConfig {
  dbPath?: string;
  embeddingEndpoint?: string;
  embeddingModel?: string;
  k?: number;
}

export default function createHybridRRFMemory(config: HybridRRFMemoryConfig): Memory {
  const dbPath = config.dbPath ?? "./data/memory-hybrid.db";
  const embeddingEndpoint = config.embeddingEndpoint ?? "http://localhost:11434/api/embeddings";
  const embeddingModel = config.embeddingModel ?? "nomic-embed-text";
  const k = config.k ?? 60;
  let db: Database.Database;

  async function getEmbedding(text: string): Promise<number[]> {
    try {
      const res = await fetch(embeddingEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: embeddingModel, prompt: text }),
      });
      if (!res.ok) return [];
      const data = await res.json() as { embedding?: number[] };
      return data.embedding ?? [];
    } catch {
      return [];
    }
  }

  function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }

  function rrfScore(ranks: number[]): number {
    return ranks.reduce((sum, rank) => sum + 1 / (k + rank + 1), 0);
  }

  return {
    name: "memory-hybrid-rrf",

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
          embedding TEXT,
          timestamp TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_hrrf_session ON messages(session_id);
      `);

      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
          content, session_id UNINDEXED, message_id UNINDEXED
        );
      `);
    },

    async saveMessages(sessionId: string, messages: Message[]) {
      const insertMsg = db.prepare(
        "INSERT INTO messages (session_id, role, content, embedding, timestamp) VALUES (?, ?, ?, ?, ?)"
      );
      const insertFts = db.prepare(
        "INSERT INTO messages_fts (content, session_id, message_id) VALUES (?, ?, ?)"
      );

      for (const msg of messages) {
        const embedding = await getEmbedding(msg.content);
        const embJson = embedding.length > 0 ? JSON.stringify(embedding) : null;
        const result = insertMsg.run(
          sessionId, msg.role, msg.content, embJson,
          (msg.timestamp ?? new Date()).toISOString()
        );
        if (msg.content.trim()) {
          insertFts.run(msg.content, sessionId, result.lastInsertRowid);
        }
      }
    },

    async loadMessages(sessionId: string, limit = 50): Promise<Message[]> {
      const rows = db.prepare(
        "SELECT role, content, timestamp FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?"
      ).all(sessionId, limit) as any[];
      return rows.reverse().map(r => ({
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
      const mode = options?.mode ?? "hybrid";

      // FTS5 keyword search
      let ftsResults: Array<{ content: string; session_id: string; rank: number }> = [];
      if (mode === "keyword" || mode === "hybrid") {
        const terms = query.replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean);
        if (terms.length > 0) {
          const ftsQuery = terms.map(t => `"${t}"`).join(" OR ");
          let sql = "SELECT content, session_id, rank FROM messages_fts WHERE messages_fts MATCH ?";
          const params: any[] = [ftsQuery];
          if (options?.sessionId) { sql += " AND session_id = ?"; params.push(options.sessionId); }
          sql += " ORDER BY rank LIMIT ?";
          params.push(limit * 2);
          ftsResults = db.prepare(sql).all(...params) as any[];
        }
      }

      // Vector search
      let vectorResults: Array<{ content: string; session_id: string; similarity: number }> = [];
      if (mode === "semantic" || mode === "hybrid") {
        const queryEmb = await getEmbedding(query);
        if (queryEmb.length > 0) {
          let sql = "SELECT content, session_id, embedding FROM messages WHERE embedding IS NOT NULL";
          const params: any[] = [];
          if (options?.sessionId) { sql += " AND session_id = ?"; params.push(options.sessionId); }
          const rows = db.prepare(sql).all(...params) as any[];
          vectorResults = rows
            .map(r => ({ content: r.content, session_id: r.session_id, similarity: cosineSimilarity(queryEmb, JSON.parse(r.embedding)) }))
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit * 2);
        }
      }

      if (mode !== "hybrid") {
        const results = mode === "keyword"
          ? ftsResults.map(r => ({ content: r.content, score: -r.rank, source: r.session_id }))
          : vectorResults.map(r => ({ content: r.content, score: r.similarity, source: r.session_id }));
        return results.slice(0, limit);
      }

      // RRF fusion
      const contentMap = new Map<string, { content: string; source: string; ranks: number[] }>();

      ftsResults.forEach((r, idx) => {
        const key = r.content;
        const entry = contentMap.get(key) ?? { content: r.content, source: r.session_id, ranks: [] };
        entry.ranks.push(idx);
        contentMap.set(key, entry);
      });

      vectorResults.forEach((r, idx) => {
        const key = r.content;
        const entry = contentMap.get(key) ?? { content: r.content, source: r.session_id, ranks: [] };
        entry.ranks.push(idx);
        contentMap.set(key, entry);
      });

      const fused = Array.from(contentMap.values())
        .map(e => ({ content: e.content, score: rrfScore(e.ranks), source: e.source }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      return fused;
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
