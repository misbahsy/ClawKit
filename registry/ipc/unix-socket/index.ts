import type { IPC } from "clawkit:types";
import { createServer, createConnection, type Server, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { unlinkSync, existsSync } from "node:fs";

export interface UnixSocketIPCConfig {
  name?: string;
  socketPath?: string;
  requestTimeout?: number;
}

interface IPCFrame {
  id: string;
  type: "message" | "request" | "response";
  channel: string;
  payload: any;
  correlationId?: string;
  timestamp: string;
}

export default function createUnixSocketIPC(config: UnixSocketIPCConfig): IPC {
  const socketPath = config.socketPath ?? "/tmp/clawkit.sock";
  const requestTimeout = config.requestTimeout ?? 30000;
  let server: Server | null = null;
  const connectedClients: Socket[] = [];
  const handlers = new Map<string, ((payload: any) => void)[]>();
  const pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  function broadcast(frame: IPCFrame): void {
    const line = JSON.stringify(frame) + "\n";
    for (let i = connectedClients.length - 1; i >= 0; i--) {
      try {
        if (!connectedClients[i].destroyed) {
          connectedClients[i].write(line);
        }
      } catch {
        connectedClients.splice(i, 1);
      }
    }
  }

  function handleFrame(frame: IPCFrame): void {
    // Handle response to a pending request
    if (frame.type === "response" && frame.correlationId) {
      const pending = pendingRequests.get(frame.correlationId);
      if (pending) {
        clearTimeout(pending.timer);
        pendingRequests.delete(frame.correlationId);
        pending.resolve(frame.payload);
      }
      return;
    }

    // Dispatch to channel handlers
    const channelHandlers = handlers.get(frame.channel) ?? [];
    for (const h of channelHandlers) {
      h(frame.payload);
    }
  }

  function handleConnection(socket: Socket): void {
    connectedClients.push(socket);
    let buffer = "";

    socket.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const frame: IPCFrame = JSON.parse(line);
          handleFrame(frame);
        } catch {
          // Skip malformed frames
        }
      }
    });

    socket.on("close", () => {
      const idx = connectedClients.indexOf(socket);
      if (idx !== -1) connectedClients.splice(idx, 1);
    });

    socket.on("error", () => {
      const idx = connectedClients.indexOf(socket);
      if (idx !== -1) connectedClients.splice(idx, 1);
    });
  }

  return {
    name: "ipc-unix-socket",

    async send(channel: string, payload: any) {
      broadcast({
        id: randomUUID(),
        type: "message",
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

        broadcast({
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
      // Clean up stale socket file
      if (existsSync(socketPath)) {
        try {
          unlinkSync(socketPath);
        } catch { /* ignore */ }
      }

      return new Promise<void>((resolve, reject) => {
        server = createServer(handleConnection);

        server.on("error", (err) => {
          reject(err);
        });

        server.listen(socketPath, () => {
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

      // Close all client connections
      for (const client of connectedClients) {
        try {
          client.destroy();
        } catch { /* ignore */ }
      }
      connectedClients.length = 0;

      if (server) {
        return new Promise<void>((resolve) => {
          server!.close(() => {
            server = null;
            // Clean up socket file
            try {
              if (existsSync(socketPath)) unlinkSync(socketPath);
            } catch { /* ignore */ }
            resolve();
          });
        });
      }
    },
  };
}
