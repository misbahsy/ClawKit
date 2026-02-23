import type { IPC } from "clawkit:types";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

export interface HttpIPCConfig {
  name?: string;
  port?: number;
  host?: string;
  targetUrl?: string;
  requestTimeout?: number;
}

interface HttpIPCMessage {
  id: string;
  channel: string;
  payload: any;
  correlationId?: string;
  isResponse?: boolean;
  timestamp: string;
}

export default function createHttpIPC(config: HttpIPCConfig): IPC {
  const port = config.port ?? 0;
  const host = config.host ?? "127.0.0.1";
  const targetUrl = config.targetUrl ?? `http://127.0.0.1:${port}`;
  const requestTimeout = config.requestTimeout ?? 30000;

  const handlers = new Map<string, ((payload: any) => void)[]>();
  const pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  let server: Server | null = null;
  let running = false;
  let actualPort = port;

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      req.on("error", reject);
    });
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    try {
      const body = await readBody(req);
      const msg: HttpIPCMessage = JSON.parse(body);

      // Handle response to a pending request
      if (msg.isResponse && msg.correlationId) {
        const pending = pendingRequests.get(msg.correlationId);
        if (pending) {
          clearTimeout(pending.timer);
          pendingRequests.delete(msg.correlationId);
          pending.resolve(msg.payload);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      // Dispatch to channel handlers
      const channelHandlers = handlers.get(msg.channel) ?? [];
      for (const h of channelHandlers) {
        h(msg.payload);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, id: msg.id }));
    } catch (err: any) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
  }

  async function postMessage(url: string, msg: HttpIPCMessage): Promise<any> {
    const body = JSON.stringify(msg);
    const parsedUrl = new URL(url);

    return new Promise((resolve, reject) => {
      const req = (parsedUrl.protocol === "https:" ? require("node:https") : require("node:http")).request(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res: IncomingMessage) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
            } catch {
              resolve(null);
            }
          });
        },
      );

      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }

  return {
    name: "ipc-http",

    async send(channel: string, payload: any) {
      const msg: HttpIPCMessage = {
        id: randomUUID(),
        channel,
        payload,
        timestamp: new Date().toISOString(),
      };
      await postMessage(targetUrl, msg);
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

        const msg: HttpIPCMessage = {
          id: randomUUID(),
          channel,
          payload,
          correlationId,
          timestamp: new Date().toISOString(),
        };

        postMessage(targetUrl, msg).catch((err) => {
          clearTimeout(timer);
          pendingRequests.delete(correlationId);
          reject(err);
        });
      });
    },

    async start() {
      running = true;

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

    async stop() {
      running = false;

      // Reject all pending requests
      for (const [id, pending] of pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(new Error("IPC stopped"));
        pendingRequests.delete(id);
      }

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
  } as IPC & { getPort(): number };
}
