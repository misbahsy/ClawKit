import type { IPC } from "clawkit:types";
import { randomUUID } from "node:crypto";

export interface MCPTransportIPCConfig {
  name?: string;
  transport: "stdio" | "streamable-http";
  command?: string;
  args?: string[];
  url?: string;
  requestTimeout?: number;
}

export default function createMCPTransportIPC(config: MCPTransportIPCConfig): IPC {
  const requestTimeout = config.requestTimeout ?? 30000;
  let client: any = null;
  let transport: any = null;
  const handlers = new Map<string, ((payload: any) => void)[]>();
  const pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  return {
    name: "ipc-mcp-transport",

    async send(channel: string, payload: any) {
      if (!client) {
        throw new Error("MCP transport not started");
      }

      try {
        // Use MCP notification mechanism to send messages
        await client.notification({
          method: "notifications/message",
          params: {
            channel,
            payload,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (err: any) {
        // Fallback: dispatch locally
        const channelHandlers = handlers.get(channel) ?? [];
        for (const h of channelHandlers) {
          h(payload);
        }
      }
    },

    onReceive(channel: string, handler: (payload: any) => void) {
      const existing = handlers.get(channel) ?? [];
      existing.push(handler);
      handlers.set(channel, existing);
    },

    async request(channel: string, payload: any, timeout?: number) {
      const effectiveTimeout = timeout ?? requestTimeout;

      if (!client) {
        throw new Error("MCP transport not started");
      }

      const correlationId = randomUUID();

      return new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingRequests.delete(correlationId);
          reject(new Error(`IPC request timeout after ${effectiveTimeout}ms`));
        }, effectiveTimeout);

        pendingRequests.set(correlationId, { resolve, reject, timer });

        // Send request via MCP
        client
          .request(
            {
              method: "clawkit/request",
              params: {
                channel,
                payload,
                correlationId,
              },
            },
            undefined,
          )
          .then((result: any) => {
            if (pendingRequests.has(correlationId)) {
              clearTimeout(timer);
              pendingRequests.delete(correlationId);
              resolve(result);
            }
          })
          .catch((err: any) => {
            if (pendingRequests.has(correlationId)) {
              clearTimeout(timer);
              pendingRequests.delete(correlationId);
              reject(err);
            }
          });
      });
    },

    async start() {
      const sdk = await import("@modelcontextprotocol/sdk/client/index.js");
      const Client = sdk.Client;

      client = new Client(
        { name: "clawkit-ipc", version: "1.0.0" },
        { capabilities: {} },
      );

      if (config.transport === "stdio") {
        if (!config.command) {
          throw new Error("command is required for stdio transport");
        }

        const stdioModule = await import("@modelcontextprotocol/sdk/client/stdio.js");
        const StdioClientTransport = stdioModule.StdioClientTransport;

        transport = new StdioClientTransport({
          command: config.command,
          args: config.args ?? [],
        });
      } else if (config.transport === "streamable-http") {
        if (!config.url) {
          throw new Error("url is required for streamable-http transport");
        }

        const httpModule = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
        const StreamableHTTPClientTransport = httpModule.StreamableHTTPClientTransport;

        transport = new StreamableHTTPClientTransport(new URL(config.url));
      } else {
        throw new Error(`Unsupported transport: ${config.transport}`);
      }

      // Set up notification handler to receive messages
      client.setNotificationHandler(
        { method: "notifications/message" },
        async (notification: any) => {
          const { channel, payload, correlationId } = notification.params ?? {};

          // Check if this is a response to a pending request
          if (correlationId) {
            const pending = pendingRequests.get(correlationId);
            if (pending) {
              clearTimeout(pending.timer);
              pendingRequests.delete(correlationId);
              pending.resolve(payload);
              return;
            }
          }

          // Dispatch to channel handlers
          if (channel) {
            const channelHandlers = handlers.get(channel) ?? [];
            for (const h of channelHandlers) {
              h(payload);
            }
          }
        },
      );

      await client.connect(transport);
    },

    async stop() {
      // Reject all pending requests
      for (const [id, pending] of pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(new Error("IPC stopped"));
        pendingRequests.delete(id);
      }

      if (client) {
        try {
          await client.close();
        } catch { /* ignore */ }
        client = null;
      }

      if (transport) {
        try {
          await transport.close?.();
        } catch { /* ignore */ }
        transport = null;
      }
    },
  };
}
