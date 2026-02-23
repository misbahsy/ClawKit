import type { Memory, Message, SearchOptions, SearchResult } from "clawkit:types";
import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface QMDMemoryConfig {
  dataDir?: string;
  collection?: string;
}

function isQmdAvailable(): boolean {
  try {
    execSync("which qmd", { stdio: "ignore" });
    return true;
  } catch { return false; }
}

export default function createQMDMemory(config: QMDMemoryConfig): Memory {
  const dataDir = config.dataDir ?? "./data/qmd";
  const collection = config.collection ?? "memory";
  let available = false;

  // Fallback: simple JSON storage when QMD is not available
  let fallbackMessages: Record<string, Message[]> = {};

  function qmdExec(args: string[]): string {
    const result = spawnSync("qmd", args, { encoding: "utf-8", cwd: dataDir, timeout: 30000 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || `qmd exited with code ${result.status}`);
    return result.stdout.trim();
  }

  return {
    name: "memory-qmd",

    async init() {
      mkdirSync(dataDir, { recursive: true });
      available = isQmdAvailable();
      if (!available) {
        console.warn("QMD binary not found. Using fallback JSON storage.");
        const fallbackPath = resolve(dataDir, "fallback.json");
        if (existsSync(fallbackPath)) {
          fallbackMessages = JSON.parse(readFileSync(fallbackPath, "utf-8"));
        }
      }
    },

    async saveMessages(sessionId: string, messages: Message[]) {
      if (!available) {
        if (!fallbackMessages[sessionId]) fallbackMessages[sessionId] = [];
        fallbackMessages[sessionId].push(...messages);
        writeFileSync(resolve(dataDir, "fallback.json"), JSON.stringify(fallbackMessages), "utf-8");
        return;
      }

      for (const msg of messages) {
        if (!msg.content.trim()) continue;
        const content = `[${sessionId}] ${msg.role}: ${msg.content}`;
        try {
          qmdExec(["add", "--collection", collection, "--content", content]);
        } catch (err: any) {
          console.error(`QMD add failed: ${err.message}`);
        }
      }
    },

    async loadMessages(sessionId: string, limit = 50): Promise<Message[]> {
      if (!available) {
        const msgs = fallbackMessages[sessionId] ?? [];
        return msgs.slice(-limit);
      }

      try {
        const output = qmdExec(["query", "--collection", collection, "--query", `session:${sessionId}`, "--limit", String(limit)]);
        if (!output) return [];
        return output.split("\n").filter(Boolean).map(line => {
          const match = line.match(/\[.*?\] (user|assistant|system): (.*)/);
          return {
            role: (match?.[1] ?? "user") as Message["role"],
            content: match?.[2] ?? line,
          };
        });
      } catch {
        return [];
      }
    },

    async clear(sessionId: string) {
      if (!available) {
        delete fallbackMessages[sessionId];
        writeFileSync(resolve(dataDir, "fallback.json"), JSON.stringify(fallbackMessages), "utf-8");
        return;
      }
      try { qmdExec(["clear", "--collection", collection, "--filter", `session:${sessionId}`]); } catch { /* ignore */ }
    },

    async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
      const limit = options?.limit ?? 5;

      if (!available) {
        const allMsgs = Object.entries(fallbackMessages).flatMap(([sid, msgs]) =>
          options?.sessionId && sid !== options.sessionId ? [] :
          msgs.filter(m => m.content.toLowerCase().includes(query.toLowerCase()))
            .map(m => ({ content: m.content, score: 1, source: sid }))
        );
        return allMsgs.slice(0, limit);
      }

      try {
        const args = ["query", "--collection", collection, "--query", query, "--limit", String(limit)];
        if (options?.sessionId) args.push("--filter", `session:${options.sessionId}`);
        const output = qmdExec(args);
        if (!output) return [];
        return output.split("\n").filter(Boolean).map((line, idx) => ({
          content: line,
          score: 1 - idx * 0.1,
          source: options?.sessionId ?? "unknown",
        }));
      } catch {
        return [];
      }
    },

    async compact(sessionId: string) {
      if (!available) {
        const msgs = fallbackMessages[sessionId] ?? [];
        if (msgs.length <= 20) return;
        fallbackMessages[sessionId] = [
          { role: "system", content: "[Earlier conversation compacted]" },
          ...msgs.slice(-10),
        ];
        writeFileSync(resolve(dataDir, "fallback.json"), JSON.stringify(fallbackMessages), "utf-8");
        return;
      }
      // QMD handles its own compaction
    },
  };
}
