import type { IPC } from "clawkit:types";
import { randomUUID } from "node:crypto";
import { resolve as pathResolve } from "node:path";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";

export interface GrpcIPCConfig {
  name?: string;
  port?: number;
  protoPath?: string;
  requestTimeout?: number;
}

const DEFAULT_PROTO = `
syntax = "proto3";

package clawkit;

service ClawKitIPC {
  rpc Send (IPCMessage) returns (Ack);
  rpc Request (IPCMessage) returns (IPCMessage);
}

message IPCMessage {
  string id = 1;
  string channel = 2;
  string payload = 3;
  string correlationId = 4;
  string timestamp = 5;
}

message Ack {
  bool ok = 1;
}
`.trim();

export default function createGrpcIPC(config: GrpcIPCConfig): IPC {
  const port = config.port ?? 50051;
  const requestTimeout = config.requestTimeout ?? 30000;
  let grpcServer: any = null;
  const handlers = new Map<string, ((payload: any) => void)[]>();
  const pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  function getProtoPath(): string {
    if (config.protoPath) return config.protoPath;

    // Write default proto to tmp if not provided
    const protoDir = pathResolve(tmpdir(), "clawkit-grpc");
    const protoFile = pathResolve(protoDir, "clawkit.proto");
    if (!existsSync(protoFile)) {
      mkdirSync(protoDir, { recursive: true });
      writeFileSync(protoFile, DEFAULT_PROTO, "utf-8");
    }
    return protoFile;
  }

  return {
    name: "ipc-grpc",

    async send(channel: string, payload: any) {
      // Dispatch locally to handlers (server-side send)
      const channelHandlers = handlers.get(channel) ?? [];
      for (const h of channelHandlers) {
        try {
          h(typeof payload === "string" ? JSON.parse(payload) : payload);
        } catch {
          h(payload);
        }
      }

      // Also available via gRPC client calls, but local dispatch is the primary path
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

        // Dispatch request to handlers
        const channelHandlers = handlers.get(channel) ?? [];
        for (const h of channelHandlers) {
          h({ __request: true, correlationId, payload });
        }
      });
    },

    async start() {
      const grpc = await import("@grpc/grpc-js");
      const protoLoader = await import("@grpc/proto-loader");

      const protoPath = getProtoPath();
      const packageDef = protoLoader.loadSync(protoPath, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      });

      const proto = grpc.loadPackageDefinition(packageDef) as any;
      grpcServer = new grpc.Server();

      grpcServer.addService(proto.clawkit.ClawKitIPC.service, {
        Send(call: any, callback: any) {
          const msg = call.request;
          const channel = msg.channel;
          let payload: any;
          try {
            payload = JSON.parse(msg.payload);
          } catch {
            payload = msg.payload;
          }

          const channelHandlers = handlers.get(channel) ?? [];
          for (const h of channelHandlers) {
            h(payload);
          }

          callback(null, { ok: true });
        },

        Request(call: any, callback: any) {
          const msg = call.request;
          const channel = msg.channel;
          const correlationId = msg.correlationId || randomUUID();
          let payload: any;
          try {
            payload = JSON.parse(msg.payload);
          } catch {
            payload = msg.payload;
          }

          // Check if there's a pending request waiting for this correlation ID (response path)
          const pending = pendingRequests.get(correlationId);
          if (pending) {
            clearTimeout(pending.timer);
            pendingRequests.delete(correlationId);
            pending.resolve(payload);
            callback(null, {
              id: randomUUID(),
              channel,
              payload: JSON.stringify({ status: "resolved" }),
              correlationId,
              timestamp: new Date().toISOString(),
            });
            return;
          }

          // Otherwise dispatch to handlers and return ack
          const channelHandlers = handlers.get(channel) ?? [];
          for (const h of channelHandlers) {
            h(payload);
          }

          callback(null, {
            id: randomUUID(),
            channel,
            payload: JSON.stringify({ status: "delivered" }),
            correlationId,
            timestamp: new Date().toISOString(),
          });
        },
      });

      return new Promise<void>((resolve, reject) => {
        grpcServer.bindAsync(
          `0.0.0.0:${port}`,
          grpc.ServerCredentials.createInsecure(),
          (err: Error | null) => {
            if (err) {
              reject(err);
              return;
            }
            resolve();
          },
        );
      });
    },

    async stop() {
      for (const [id, pending] of pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(new Error("IPC stopped"));
        pendingRequests.delete(id);
      }

      if (grpcServer) {
        return new Promise<void>((resolve) => {
          grpcServer.tryShutdown(() => {
            grpcServer = null;
            resolve();
          });
        });
      }
    },
  };
}
