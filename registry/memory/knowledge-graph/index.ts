import type { Memory, Message, SearchOptions, SearchResult } from "clawkit:types";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface KnowledgeGraphMemoryConfig {
  dataDir?: string;
}

export interface GraphNode {
  id: string;
  entity: string;
  type: string;
  properties: Record<string, string>;
  sessionId: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  relationship: string;
  metadata: Record<string, string>;
  sessionId: string;
}

interface GraphState {
  nodes: GraphNode[];
  edges: GraphEdge[];
  messages: Record<string, Array<{ role: string; content: string; timestamp: string }>>;
}

export default function createKnowledgeGraphMemory(config: KnowledgeGraphMemoryConfig): Memory {
  const dataDir = config.dataDir ?? "./data/knowledge-graph";

  let state: GraphState = { nodes: [], edges: [], messages: {} };

  function graphPath(): string {
    return resolve(dataDir, "graph.json");
  }

  function persist(): void {
    writeFileSync(graphPath(), JSON.stringify(state, null, 2), "utf-8");
  }

  function generateId(): string {
    return `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function findOrCreateNode(entity: string, type: string, sessionId: string): GraphNode {
    const normalized = entity.toLowerCase();
    let existing = state.nodes.find((n) => n.entity.toLowerCase() === normalized);
    if (!existing) {
      existing = { id: generateId(), entity, type, properties: {}, sessionId };
      state.nodes.push(existing);
    }
    return existing;
  }

  function addEdge(fromId: string, toId: string, relationship: string, sessionId: string): void {
    const exists = state.edges.find(
      (e) => e.from === fromId && e.to === toId && e.relationship === relationship,
    );
    if (!exists) {
      state.edges.push({ from: fromId, to: toId, relationship, metadata: {}, sessionId });
    }
  }

  function extractEntitiesAndRelationships(text: string, sessionId: string): void {
    // Pattern: "X is a Y"
    const isAPattern = /\b([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)*)\s+is\s+(?:a|an|the)\s+(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = isAPattern.exec(text)) !== null) {
      findOrCreateNode(match[1], match[2], sessionId);
    }

    // Pattern: "X <verb> Y"
    const relPattern =
      /\b([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)*)\s+(works at|lives in|created|built|uses|manages|depends on|connects to)\s+([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)*)/g;
    while ((match = relPattern.exec(text)) !== null) {
      const fromNode = findOrCreateNode(match[1], "entity", sessionId);
      const toNode = findOrCreateNode(match[3], "entity", sessionId);
      addEdge(fromNode.id, toNode.id, match[2], sessionId);
    }
  }

  return {
    name: "memory-knowledge-graph",

    async init() {
      mkdirSync(dataDir, { recursive: true });
      const path = graphPath();
      if (existsSync(path)) {
        try {
          state = JSON.parse(readFileSync(path, "utf-8"));
        } catch {
          state = { nodes: [], edges: [], messages: {} };
        }
      }
    },

    async saveMessages(sessionId: string, messages: Message[]) {
      if (!state.messages[sessionId]) state.messages[sessionId] = [];
      for (const msg of messages) {
        state.messages[sessionId].push({
          role: msg.role,
          content: msg.content,
          timestamp: (msg.timestamp ?? new Date()).toISOString(),
        });
        extractEntitiesAndRelationships(msg.content, sessionId);
      }
      persist();
    },

    async loadMessages(sessionId: string, limit = 50): Promise<Message[]> {
      const msgs = state.messages[sessionId] ?? [];
      return msgs.slice(-limit).map((m) => ({
        role: m.role as Message["role"],
        content: m.content,
        timestamp: new Date(m.timestamp),
      }));
    },

    async clear(sessionId: string) {
      delete state.messages[sessionId];
      state.nodes = state.nodes.filter((n) => n.sessionId !== sessionId);
      state.edges = state.edges.filter((e) => e.sessionId !== sessionId);
      persist();
    },

    async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
      const limit = options?.limit ?? 5;
      const lower = query.toLowerCase();
      const results: SearchResult[] = [];

      // Search nodes
      for (const node of state.nodes) {
        if (options?.sessionId && node.sessionId !== options.sessionId) continue;
        if (node.entity.toLowerCase().includes(lower) || node.type.toLowerCase().includes(lower)) {
          const edges = state.edges.filter((e) => e.from === node.id || e.to === node.id);
          const edgeDescriptions = edges.map((e) => {
            const from = state.nodes.find((n) => n.id === e.from);
            const to = state.nodes.find((n) => n.id === e.to);
            return `${from?.entity ?? e.from} ${e.relationship} ${to?.entity ?? e.to}`;
          });
          const content =
            `Entity: ${node.entity} (${node.type})` +
            (edgeDescriptions.length > 0 ? `\nRelationships: ${edgeDescriptions.join("; ")}` : "");
          results.push({ content, score: 1, source: node.sessionId });
        }
      }

      // Search edges by relationship
      for (const edge of state.edges) {
        if (options?.sessionId && edge.sessionId !== options.sessionId) continue;
        if (edge.relationship.toLowerCase().includes(lower)) {
          const from = state.nodes.find((n) => n.id === edge.from);
          const to = state.nodes.find((n) => n.id === edge.to);
          const content = `${from?.entity ?? edge.from} ${edge.relationship} ${to?.entity ?? edge.to}`;
          // Avoid duplicates
          if (!results.find((r) => r.content === content)) {
            results.push({ content, score: 0.8, source: edge.sessionId });
          }
        }
      }

      // Also search raw messages as fallback
      const sessions = options?.sessionId
        ? { [options.sessionId]: state.messages[options.sessionId] ?? [] }
        : state.messages;

      for (const [sid, msgs] of Object.entries(sessions)) {
        if (!msgs) continue;
        for (const msg of msgs) {
          if (msg.content.toLowerCase().includes(lower)) {
            if (!results.find((r) => r.content === msg.content)) {
              results.push({ content: msg.content, score: 0.5, source: sid });
            }
          }
        }
      }

      return results.slice(0, limit);
    },

    async compact(sessionId: string) {
      const msgs = state.messages[sessionId] ?? [];
      if (msgs.length <= 20) return;
      const keep = msgs.slice(-10);
      state.messages[sessionId] = [
        {
          role: "system",
          content: "[Earlier conversation context was compacted]",
          timestamp: new Date().toISOString(),
        },
        ...keep,
      ];
      // Keep graph nodes/edges (they represent long-term knowledge)
      persist();
    },
  };
}
