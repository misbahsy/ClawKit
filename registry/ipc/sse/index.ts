import type { IPC } from "clawkit:types";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { randomUUID } from "node:crypto";

export interface SSEIPCConfig {
  name?: string;
  port?: number;
  requestTimeout?: number;
}

interface SSEClient {
  id: string;
  res: ServerResponse;
}

export default function createSSEIPC(config: SSEIPCConfig): IPC {
  const port = config.port ?? 9801;
  const requestTimeout = config.requestTimeout ?? 30000;
  let server: Server | null = null;
  const clients: SSEClient[] = [];
  const handlers = new Map<string, ((payload: any) => void)[]>();
  const pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  function broadcastSSE(event: string, data: any): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (let i = clients.length - 1; i >= 0; i--) {
      try {
        clients[i].res.write(payload);
      } catch {
        // Remove dead clients
        clients.splice(i, 1);
      }
    }
  }

  function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    // SSE endpoint: clients connect via GET /events
    if (req.method === "GET" && req.url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const client: SSEClient = { id: randomUUID(), res };
      clients.push(client);

      // Send initial connection event
      res.write(`event: connected\ndata: ${JSON.stringify({ clientId: client.id })}\n\n`);

      req.on("close", () => {
        const idx = clients.indexOf(client);
        if (idx !== -1) clients.splice(idx, 1);
      });
      return;
    }

    // Receive endpoint: external systems POST messages
    if (req.method === "POST" && req.url === "/receive") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        try {
          const msg = JSON.parse(body);
          const channel = msg.channel ?? "default";
          const payload = msg.payload;

          // Check if this is a response to a pending request
          if (msg.correlationId) {
            const pending = pendingRequests.get(msg.correlationId);
            if (pending) {
              clearTimeout(pending.timer);
              pendingRequests.delete(msg.correlationId);
              pending.resolve(payload);
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ status: "ok", type: "response" }));
              return;
            }
          }

          // Dispatch to channel handlers
          const channelHandlers = handlers.get(channel) ?? [];
          for (const h of channelHandlers) {
            h(payload);
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok" }));
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
        }
      });
      return;
    }

    // Health check
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", clients: clients.length }));
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  }

  return {
    name: "ipc-sse",

    async send(channel: string, payload: any) {
      broadcastSSE(channel, {
        id: randomUUID(),
        channel,
        payload,
        timestamp: new Date().toISOString(),
      });
    },

    onReceive(channel: string, handler: (payload: any) => void) {
      const existing = handlers.get(channel) ?? [];
      existing.push(handler);
      handlers.set(channel, existing);
    },

    async request(channel: string, payload: any, timeout?: number) {
      const effectiveTimeout = timeout ?? requestTimeout;
      const correlationId = randomUUID();

      return new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingRequests.delete(correlationId);
          reject(new Error(`IPC request timeout after ${effectiveTimeout}ms`));
        }, effectiveTimeout);

        pendingRequests.set(correlationId, { resolve, reject, timer });

        // Broadcast the request via SSE so a consumer can respond via POST /receive
        broadcastSSE(channel, {
          id: randomUUID(),
          type: "request",
          channel,
          payload,
          correlationId,
          timestamp: new Date().toISOString(),
        });
      });
    },

    async start() {
      return new Promise<void>((resolve) => {
        server = createServer(handleRequest);
        server.listen(port, () => {
          resolve();
        });
      });
    },

    async stop() {
      // Reject all pending requests
      for (const [id, pending] of pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(new Error("IPC stopped"));
        pendingRequests.delete(id);
      }

      // Close all SSE connections
      for (const client of clients) {
        try {
          client.res.end();
        } catch { /* ignore */ }
      }
      clients.length = 0;

      if (server) {
        return new Promise<void>((resolve) => {
          server!.close(() => {
            server = null;
            resolve();
          });
        });
      }
    },
  };
}
