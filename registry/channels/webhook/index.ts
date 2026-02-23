import type { Channel, ChannelConfig, IncomingMessage, MessageContent, MediaContent } from "clawkit:types";
import { createServer, type Server, type IncomingMessage as HttpIncoming, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

export interface WebhookChannelConfig {
  port?: number;
  host?: string;
  path?: string;
  secret?: string;
}

interface StoredResponse {
  id: string;
  content: MessageContent;
  timestamp: Date;
}

export default function createWebhookChannel(config: WebhookChannelConfig): Channel {
  const port = config.port ?? 0;
  const host = config.host ?? "127.0.0.1";
  const basePath = config.path ?? "/message";
  const secret = config.secret;

  let server: Server | null = null;
  let messageCallback: ((msg: IncomingMessage) => void) | null = null;
  const responses = new Map<string, StoredResponse>();
  let actualPort = port;

  function readBody(req: HttpIncoming): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      req.on("error", reject);
    });
  }

  function verifySecret(req: HttpIncoming): boolean {
    if (!secret) return true;
    const header = req.headers["x-webhook-secret"] ?? req.headers["authorization"];
    if (!header) return false;
    const token = typeof header === "string" ? header.replace(/^Bearer\s+/i, "") : "";
    return token === secret;
  }

  async function handleRequest(req: HttpIncoming, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${host}:${actualPort}`);

    // POST /message - incoming webhook
    if (req.method === "POST" && url.pathname === basePath) {
      if (!verifySecret(req)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      try {
        const body = await readBody(req);
        const data = JSON.parse(body);

        const incomingMessage: IncomingMessage = {
          id: data.id ?? randomUUID(),
          channel: "webhook",
          sender: data.sender ?? "webhook",
          senderName: data.senderName,
          content: data.content ?? data.text ?? "",
          media: data.media,
          group: data.group,
          groupName: data.groupName,
          replyTo: data.replyTo,
          timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
          raw: data,
        };

        if (messageCallback) {
          messageCallback(incomingMessage);
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, id: incomingMessage.id }));
      } catch (err: any) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // GET /response/:id - retrieve stored response
    const responseMatch = url.pathname.match(/^\/response\/([^/]+)$/);
    if (req.method === "GET" && responseMatch) {
      const responseId = responseMatch[1];
      const stored = responses.get(responseId);

      if (stored) {
        responses.delete(responseId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: stored.id, content: stored.content, timestamp: stored.timestamp.toISOString() }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Response not found" }));
      }
      return;
    }

    // Health check
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", channel: "webhook" }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }

  return {
    name: "webhook",

    async connect(_config?: ChannelConfig) {
      return new Promise<void>((resolve, reject) => {
        server = createServer((req, res) => {
          handleRequest(req, res).catch(() => {
            res.writeHead(500);
            res.end();
          });
        });

        server.on("error", reject);
        server.listen(port, host, () => {
          const addr = server!.address();
          if (addr && typeof addr === "object") {
            actualPort = addr.port;
          }
          resolve();
        });
      });
    },

    onMessage(callback) {
      messageCallback = callback;
    },

    async sendMessage(to: string, content: MessageContent) {
      const id = to || randomUUID();
      responses.set(id, {
        id,
        content,
        timestamp: new Date(),
      });
    },

    async sendMedia(_to: string, _media: MediaContent) {
      // Media is not directly supported via webhook responses
      // Clients should use the response endpoint to retrieve media info
    },

    async disconnect() {
      if (server) {
        return new Promise<void>((resolve) => {
          server!.close(() => {
            server = null;
            resolve();
          });
        });
      }
    },

    getPort(): number {
      return actualPort;
    },
  } as Channel & { getPort(): number };
}
