import type { Memory, Message, SearchOptions, SearchResult } from "clawkit:types";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface LucidMemoryConfig {
  dataDir?: string;
}

interface StoredMessage {
  role: string;
  content: string;
  timestamp: string;
}

interface LucidState {
  sessions: Record<string, StoredMessage[]>;
  meta: Record<string, any>;
}

export interface LucidMemory extends Memory {
  /** Serialize current in-memory state to a JSON-serializable snapshot. */
  snapshot(): LucidState;
  /** Restore state from a previously taken snapshot. */
  hydrate(state: LucidState): void;
}

export default function createLucidMemory(config: LucidMemoryConfig): LucidMemory {
  const dataDir = config.dataDir ?? "./data/memory-lucid";
  let state: LucidState = { sessions: {}, meta: {} };

  function statePath(): string {
    return resolve(dataDir, "lucid-state.json");
  }

  function persist(): void {
    writeFileSync(statePath(), JSON.stringify(state, null, 2), "utf-8");
  }

  return {
    name: "memory-lucid",

    async init() {
      mkdirSync(dataDir, { recursive: true });
      const path = statePath();
      if (existsSync(path)) {
        try {
          state = JSON.parse(readFileSync(path, "utf-8"));
        } catch {
          state = { sessions: {}, meta: {} };
        }
      }
    },

    snapshot(): LucidState {
      return JSON.parse(JSON.stringify(state));
    },

    hydrate(newState: LucidState): void {
      state = JSON.parse(JSON.stringify(newState));
      persist();
    },

    async saveMessages(sessionId: string, messages: Message[]) {
      if (!state.sessions[sessionId]) state.sessions[sessionId] = [];
      for (const msg of messages) {
        state.sessions[sessionId].push({
          role: msg.role,
          content: msg.content,
          timestamp: (msg.timestamp ?? new Date()).toISOString(),
        });
      }
      persist();
    },

    async loadMessages(sessionId: string, limit = 50): Promise<Message[]> {
      const msgs = state.sessions[sessionId] ?? [];
      return msgs.slice(-limit).map((m) => ({
        role: m.role as Message["role"],
        content: m.content,
        timestamp: new Date(m.timestamp),
      }));
    },

    async clear(sessionId: string) {
      delete state.sessions[sessionId];
      persist();
    },

    async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
      const limit = options?.limit ?? 5;
      const lower = query.toLowerCase();
      const results: SearchResult[] = [];

      const sessions = options?.sessionId
        ? { [options.sessionId]: state.sessions[options.sessionId] ?? [] }
        : state.sessions;

      for (const [sid, msgs] of Object.entries(sessions)) {
        if (!msgs) continue;
        for (const msg of msgs) {
          if (msg.content.toLowerCase().includes(lower)) {
            results.push({ content: msg.content, score: 1, source: sid });
          }
        }
      }

      return results.slice(0, limit);
    },

    async compact(sessionId: string) {
      const msgs = state.sessions[sessionId] ?? [];
      if (msgs.length <= 20) return;
      const keep = msgs.slice(-10);
      state.sessions[sessionId] = [
        {
          role: "system",
          content: "[Earlier conversation context was compacted]",
          timestamp: new Date().toISOString(),
        },
        ...keep,
      ];
      persist();
    },
  };
}
