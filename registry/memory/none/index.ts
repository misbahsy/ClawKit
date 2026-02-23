import type { Memory, Message, SearchOptions, SearchResult } from "clawkit:types";

export interface NoneMemoryConfig {
  name?: string;
}

export default function createNoneMemory(_config: NoneMemoryConfig): Memory {
  const sessions = new Map<string, Message[]>();

  return {
    name: "memory-none",

    async init() {},

    async saveMessages(sessionId: string, messages: Message[]) {
      const existing = sessions.get(sessionId) ?? [];
      existing.push(...messages);
      sessions.set(sessionId, existing);
    },

    async loadMessages(sessionId: string, limit = 50): Promise<Message[]> {
      const msgs = sessions.get(sessionId) ?? [];
      return msgs.slice(-limit);
    },

    async clear(sessionId: string) {
      sessions.delete(sessionId);
    },

    async search(_query: string, _options?: SearchOptions): Promise<SearchResult[]> {
      return [];
    },

    async compact(sessionId: string) {
      const msgs = sessions.get(sessionId) ?? [];
      if (msgs.length > 20) {
        sessions.set(sessionId, msgs.slice(-10));
      }
    },
  };
}
