import type { IPC } from "clawkit:types";
import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";

export interface WebSocketIPCConfig {
  name?: string;
  port?: number;
  requestTimeout?: number;
}

interface IPCFrame {
  id: string;
  type: "message" | "request" | "response";
  channel: string;
  payload: any;
  correlationId?: string;
}

export default function createWebSocketIPC(config: WebSocketIPCConfig): IPC {
  const port = config.port ?? 9800;
  const requestTimeout = config.requestTimeout ?? 30000;
  let wss: WebSocketServer | null = null;
  const handlers = new Map<string, ((payload: any) => void)[]>();
  const pendingRequests = new Map<string, { resolve: (value: any) => void; reject: (reason: any) => void }>();

  function broadcast(frame: IPCFrame): void {
    if (!wss) return;
    const data = JSON.stringify(frame);
    for (const client of wss.clients) {
      if (client.readyState === 1 /* OPEN */) {
        client.send(data);
      }
    }
  }

  function handleFrame(frame: IPCFrame): void {
    if (frame.type === "response" && frame.correlationId) {
      const pending = pendingRequests.get(frame.correlationId);
      if (pending) {
        pendingRequests.delete(frame.correlationId);
        pending.resolve(frame.payload);
      }
      return;
    }

    const channelHandlers = handlers.get(frame.channel) ?? [];
    for (const h of channelHandlers) {
      h(frame.payload);
    }
  }

  return {
    name: "ipc-websocket",

    async send(channel: string, payload: any) {
      broadcast({
        id: randomUUID(),
        type: "message",
        channel,
        payload,
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

        pendingRequests.set(correlationId, {
          resolve: (value: any) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (reason: any) => {
            clearTimeout(timer);
            reject(reason);
          },
        });

        broadcast({
          id: randomUUID(),
          type: "request",
          channel,
          payload,
          correlationId,
        });
      });
    },

    async start() {
      return new Promise<void>((resolve) => {
        wss = new WebSocketServer({ port }, () => {
          console.log(`WebSocket IPC listening on port ${port}`);
          resolve();
        });

        wss.on("connection", (ws) => {
          ws.on("message", (data) => {
            try {
              const frame: IPCFrame = JSON.parse(data.toString());
              handleFrame(frame);
            } catch {
              // Ignore malformed frames
            }
          });
        });
      });
    },

    async stop() {
      if (wss) {
        for (const [id, pending] of pendingRequests) {
          pending.reject(new Error("IPC shutting down"));
          pendingRequests.delete(id);
        }
        return new Promise<void>((resolve) => {
          wss!.close(() => {
            wss = null;
            resolve();
          });
        });
      }
    },
  };
}
