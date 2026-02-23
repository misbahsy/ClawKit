import type { Memory, Message, SearchOptions, SearchResult } from "clawkit:types";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface VectorMemoryConfig {
  embeddingEndpoint?: string;
  embeddingModel?: string;
  dataDir?: string;
}

interface StoredEntry {
  sessionId: string;
  role: string;
  content: string;
  embedding: number[];
  timestamp: string;
}

export default function createVectorMemory(config: VectorMemoryConfig): Memory {
  const embeddingEndpoint = config.embeddingEndpoint ?? "http://localhost:11434/api/embed";
  const embeddingModel = config.embeddingModel ?? "nomic-embed-text";
  const dataDir = config.dataDir ?? "./data/memory-vector";

  let entries: StoredEntry[] = [];

  function storagePath(): string {
    return resolve(dataDir, "vectors.json");
  }

  function persist(): void {
    writeFileSync(storagePath(), JSON.stringify(entries), "utf-8");
  }

  async function getEmbedding(text: string): Promise<number[]> {
    try {
      const res = await fetch(embeddingEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: embeddingModel, input: text }),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { embeddings?: number[][] };
      return data.embeddings?.[0] ?? [];
    } catch {
      return [];
    }
  }

  function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0,
      magA = 0,
      magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }

  return {
    name: "memory-vector",

    async init() {
      mkdirSync(dataDir, { recursive: true });
      const path = storagePath();
      if (existsSync(path)) {
        try {
          entries = JSON.parse(readFileSync(path, "utf-8"));
        } catch {
          entries = [];
        }
      }
    },

    async saveMessages(sessionId: string, messages: Message[]) {
      for (const msg of messages) {
        const embedding = await getEmbedding(msg.content);
        entries.push({
          sessionId,
          role: msg.role,
          content: msg.content,
          embedding,
          timestamp: (msg.timestamp ?? new Date()).toISOString(),
        });
      }
      persist();
    },

    async loadMessages(sessionId: string, limit = 50): Promise<Message[]> {
      const sessionEntries = entries.filter((e) => e.sessionId === sessionId);
      return sessionEntries.slice(-limit).map((e) => ({
        role: e.role as Message["role"],
        content: e.content,
        timestamp: new Date(e.timestamp),
      }));
    },

    async clear(sessionId: string) {
      entries = entries.filter((e) => e.sessionId !== sessionId);
      persist();
    },

    async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
      const limit = options?.limit ?? 5;
      const queryEmb = await getEmbedding(query);

      const candidates = options?.sessionId
        ? entries.filter((e) => e.sessionId === options.sessionId)
        : entries;

      if (queryEmb.length === 0) {
        // Fallback to substring match when embeddings unavailable
        const lower = query.toLowerCase();
        return candidates
          .filter((e) => e.content.toLowerCase().includes(lower))
          .map((e) => ({ content: e.content, score: 1, source: e.sessionId }))
          .slice(0, limit);
      }

      return candidates
        .filter((e) => e.embedding.length > 0)
        .map((e) => ({
          content: e.content,
          score: cosineSimilarity(queryEmb, e.embedding),
          source: e.sessionId,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    },

    async compact(sessionId: string) {
      const sessionEntries = entries.filter((e) => e.sessionId === sessionId);
      if (sessionEntries.length <= 20) return;
      const keep = sessionEntries.slice(-10);
      entries = entries.filter((e) => e.sessionId !== sessionId);
      entries.push(
        {
          sessionId,
          role: "system",
          content: "[Earlier conversation context was compacted]",
          embedding: [],
          timestamp: new Date().toISOString(),
        },
        ...keep,
      );
      persist();
    },
  };
}
