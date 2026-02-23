import type { IPC } from "clawkit:types";
import { randomUUID } from "node:crypto";

export interface StdioIPCConfig {
  name?: string;
  requestTimeout?: number;
  inputStream?: NodeJS.ReadableStream;
  outputStream?: NodeJS.WritableStream;
}

interface StdioMessage {
  id: string;
  channel: string;
  payload: any;
  correlationId?: string;
  isResponse?: boolean;
  timestamp: string;
}

export default function createStdioIPC(config: StdioIPCConfig): IPC {
  const requestTimeout = config.requestTimeout ?? 30000;
  const handlers = new Map<string, ((payload: any) => void)[]>();
  const pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  let running = false;
  let buffer = "";
  const inputStream = config.inputStream ?? process.stdin;
  const outputStream = config.outputStream ?? process.stdout;
  let dataHandler: ((chunk: Buffer) => void) | null = null;

  function writeLine(msg: StdioMessage): void {
    const line = JSON.stringify(msg) + "\n";
    outputStream.write(line);
  }

  function handleLine(line: string): void {
    if (!line.trim()) return;

    let msg: StdioMessage;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // skip malformed lines
    }

    // Handle response to a pending request
    if (msg.isResponse && msg.correlationId) {
      const pending = pendingRequests.get(msg.correlationId);
      if (pending) {
        clearTimeout(pending.timer);
        pendingRequests.delete(msg.correlationId);
        pending.resolve(msg.payload);
      }
      return;
    }

    // Dispatch to channel handlers
    const channelHandlers = handlers.get(msg.channel) ?? [];
    for (const h of channelHandlers) {
      h(msg.payload);
    }
  }

  return {
    name: "ipc-stdio",

    async send(channel: string, payload: any) {
      writeLine({
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

        writeLine({
          id: randomUUID(),
          channel,
          payload,
          correlationId,
          timestamp: new Date().toISOString(),
        });
      });
    },

    async start() {
      running = true;
      inputStream.setEncoding?.("utf-8" as any);

      dataHandler = (chunk: Buffer) => {
        if (!running) return;
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          handleLine(line);
        }
      };

      inputStream.on("data", dataHandler);
    },

    async stop() {
      running = false;
      if (dataHandler) {
        inputStream.removeListener("data", dataHandler);
        dataHandler = null;
      }
      buffer = "";

      // Reject all pending requests
      for (const [id, pending] of pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(new Error("IPC stopped"));
        pendingRequests.delete(id);
      }
    },
  };
}
