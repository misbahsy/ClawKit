import type { IPC } from "clawkit:types";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, watch } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

export interface FilesystemIPCConfig {
  name?: string;
  ipcDir?: string;
  requestTimeout?: number;
}

interface IPCMessage {
  id: string;
  channel: string;
  payload: any;
  replyTo?: string;
  timestamp: string;
}

export default function createFilesystemIPC(config: FilesystemIPCConfig): IPC {
  const ipcDir = config.ipcDir ?? "./data/ipc";
  const requestTimeout = config.requestTimeout ?? 30000;
  const handlers = new Map<string, ((payload: any) => void)[]>();
  const watchers: ReturnType<typeof watch>[] = [];
  const processedIds = new Set<string>();
  const MAX_PROCESSED_IDS = 10000;
  let running = false;

  function channelDir(channel: string): string {
    const safe = channel.replace(/[^a-zA-Z0-9_-]/g, "_");
    return resolve(ipcDir, safe);
  }

  function ensureChannelDir(channel: string): string {
    const dir = channelDir(channel);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  function writeMessage(msg: IPCMessage): void {
    const dir = ensureChannelDir(msg.channel);
    writeFileSync(resolve(dir, `${msg.id}.json`), JSON.stringify(msg, null, 2), "utf-8");
  }

  function pollChannel(channel: string): void {
    const dir = channelDir(channel);
    if (!existsSync(dir)) return;

    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const id = file.replace(".json", "");
      if (processedIds.has(id)) continue;

      try {
        const msg: IPCMessage = JSON.parse(readFileSync(resolve(dir, file), "utf-8"));
        processedIds.add(id);
        if (processedIds.size > MAX_PROCESSED_IDS) {
          const firstId = processedIds.values().next().value;
          processedIds.delete(firstId!);
        }

        const channelHandlers = handlers.get(channel) ?? [];
        for (const h of channelHandlers) {
          h(msg.payload);
        }

        // Clean up processed message
        try { rmSync(resolve(dir, file)); } catch { /* ignore */ }
      } catch {
        // Skip malformed files
      }
    }
  }

  function watchChannel(channel: string): void {
    const dir = ensureChannelDir(channel);
    try {
      const watcher = watch(dir, () => {
        if (running) pollChannel(channel);
      });
      watchers.push(watcher);
    } catch {
      // Fallback: poll on interval if watch not supported
    }
  }

  return {
    name: "ipc-filesystem",

    async send(channel: string, payload: any) {
      writeMessage({
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

      if (running) {
        watchChannel(channel);
      }
    },

    async request(channel: string, payload: any, timeout?: number) {
      const effectiveTimeout = timeout ?? requestTimeout;
      const requestId = randomUUID();
      const responseChannel = `${channel}__response`;

      return new Promise<any>((res, rej) => {
        const timer = setTimeout(() => {
          rej(new Error(`IPC request timeout after ${effectiveTimeout}ms`));
        }, effectiveTimeout);

        const responseDir = ensureChannelDir(responseChannel);
        const expectedFile = resolve(responseDir, `${requestId}.json`);

        const pollInterval = setInterval(() => {
          if (existsSync(expectedFile)) {
            clearInterval(pollInterval);
            clearTimeout(timer);
            try {
              const msg: IPCMessage = JSON.parse(readFileSync(expectedFile, "utf-8"));
              rmSync(expectedFile);
              res(msg.payload);
            } catch (err) {
              rej(err);
            }
          }
        }, 50);

        writeMessage({
          id: requestId,
          channel,
          payload,
          replyTo: responseChannel,
          timestamp: new Date().toISOString(),
        });
      });
    },

    async start() {
      running = true;
      mkdirSync(ipcDir, { recursive: true });

      for (const channel of handlers.keys()) {
        watchChannel(channel);
        pollChannel(channel);
      }
    },

    async stop() {
      running = false;
      for (const w of watchers) {
        w.close();
      }
      watchers.length = 0;
    },
  };
}
