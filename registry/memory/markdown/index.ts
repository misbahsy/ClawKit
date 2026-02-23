import type { Memory, Message, SearchOptions, SearchResult } from "clawkit:types";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

export interface MarkdownMemoryConfig {
  name?: string;
  sessionDir?: string;
}

interface ParsedMessage {
  role: string;
  content: string;
  timestamp: string;
}

export default function createMarkdownMemory(config: MarkdownMemoryConfig): Memory {
  const sessionDir = config.sessionDir ?? "./data/sessions";

  function sessionPath(sessionId: string): string {
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return resolve(sessionDir, `${safe}.md`);
  }

  function parseMarkdown(content: string): ParsedMessage[] {
    const messages: ParsedMessage[] = [];
    const lines = content.split("\n");
    let current: ParsedMessage | null = null;
    const contentLines: string[] = [];

    function flush() {
      if (current) {
        current.content = contentLines.join("\n").trim();
        messages.push(current);
        contentLines.length = 0;
      }
    }

    for (const line of lines) {
      const match = line.match(/^- \*\*(user|assistant|system)\*\* \(([^)]+)\): (.*)/);
      if (match) {
        flush();
        current = { role: match[1], content: "", timestamp: match[2] };
        contentLines.push(match[3]);
      } else if (current) {
        // Continuation lines start with "  " (indented under the list item)
        contentLines.push(line.startsWith("  ") ? line.slice(2) : line);
      }
    }
    flush();
    return messages;
  }

  function toMarkdown(messages: ParsedMessage[]): string {
    const lines: string[] = ["# Session Messages", ""];
    for (const msg of messages) {
      const escaped = msg.content.replace(/\n/g, "\n  ");
      lines.push(`- **${msg.role}** (${msg.timestamp}): ${escaped}`);
    }
    lines.push("");
    return lines.join("\n");
  }

  function readSession(sessionId: string): ParsedMessage[] {
    const path = sessionPath(sessionId);
    if (!existsSync(path)) return [];
    try {
      return parseMarkdown(readFileSync(path, "utf-8"));
    } catch {
      return [];
    }
  }

  function writeSession(sessionId: string, messages: ParsedMessage[]): void {
    writeFileSync(sessionPath(sessionId), toMarkdown(messages), "utf-8");
  }

  return {
    name: "memory-markdown",

    async init() {
      mkdirSync(sessionDir, { recursive: true });
    },

    async saveMessages(sessionId: string, messages: Message[]) {
      const existing = readSession(sessionId);
      for (const msg of messages) {
        existing.push({
          role: msg.role,
          content: msg.content,
          timestamp: (msg.timestamp ?? new Date()).toISOString(),
        });
      }
      writeSession(sessionId, existing);
    },

    async loadMessages(sessionId: string, limit = 50): Promise<Message[]> {
      const messages = readSession(sessionId);
      return messages.slice(-limit).map((m) => ({
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
      const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const results: SearchResult[] = [];

      const files = existsSync(sessionDir) ? readdirSync(sessionDir).filter((f) => f.endsWith(".md")) : [];

      for (const file of files) {
        const sid = file.replace(".md", "");
        if (options?.sessionId && sid !== options.sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")) continue;

        const messages = readSession(sid);
        for (const msg of messages) {
          if (regex.test(msg.content)) {
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
      const messages = readSession(sessionId);
      if (messages.length <= 20) return;

      const keep = messages.slice(-10);
      writeSession(sessionId, [
        { role: "system", content: "[Earlier conversation context was compacted]", timestamp: new Date().toISOString() },
        ...keep,
      ]);
    },
  };
}
