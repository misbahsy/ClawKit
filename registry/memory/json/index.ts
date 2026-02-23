import type { Memory, Message, SearchOptions, SearchResult } from "clawkit:types";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

export interface JsonMemoryConfig {
  name?: string;
  sessionDir?: string;
}

interface StoredMessage {
  role: string;
  content: string;
  timestamp: string;
}

export default function createJsonMemory(config: JsonMemoryConfig): Memory {
  const sessionDir = config.sessionDir ?? "./data/sessions";

  function sessionPath(sessionId: string): string {
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return resolve(sessionDir, `${safe}.json`);
  }

  function readSession(sessionId: string): { messages: StoredMessage[] } {
    const path = sessionPath(sessionId);
    if (!existsSync(path)) return { messages: [] };
    try {
      return JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      return { messages: [] };
    }
  }

  function writeSession(sessionId: string, data: { messages: StoredMessage[] }): void {
    writeFileSync(sessionPath(sessionId), JSON.stringify(data, null, 2), "utf-8");
  }

  return {
    name: "memory-json",

    async init() {
      mkdirSync(sessionDir, { recursive: true });
    },

    async saveMessages(sessionId: string, messages: Message[]) {
      const data = readSession(sessionId);
      for (const msg of messages) {
        data.messages.push({
          role: msg.role,
          content: msg.content,
          timestamp: (msg.timestamp ?? new Date()).toISOString(),
        });
      }
      writeSession(sessionId, data);
    },

    async loadMessages(sessionId: string, limit = 50): Promise<Message[]> {
      const data = readSession(sessionId);
      const slice = data.messages.slice(-limit);
      return slice.map((m) => ({
        role: m.role as Message["role"],
        content: m.content,
        timestamp: new Date(m.timestamp),
      }));
    },

    async clear(sessionId: string) {
      const path = sessionPath(sessionId);
      if (existsSync(path)) {
        rmSync(path);
      }
    },

    async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
      const limit = options?.limit ?? 5;
      const lowerQuery = query.toLowerCase();
      const results: SearchResult[] = [];

      const files = existsSync(sessionDir) ? readdirSync(sessionDir).filter((f) => f.endsWith(".json")) : [];

      for (const file of files) {
        const sid = file.replace(".json", "");
        if (options?.sessionId && sid !== options.sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")) continue;

        const data = readSession(sid);
        for (const msg of data.messages) {
          if (msg.content.toLowerCase().includes(lowerQuery)) {
            results.push({
              content: msg.content,
              score: 1,
              source: sid,
            });
          }
        }
      }

      return results.slice(0, limit);
    },

    async compact(sessionId: string) {
      const data = readSession(sessionId);
      if (data.messages.length <= 20) return;

      const keep = data.messages.slice(-10);
      writeSession(sessionId, {
        messages: [
          { role: "system", content: "[Earlier conversation context was compacted]", timestamp: new Date().toISOString() },
          ...keep,
        ],
      });
    },
  };
}
