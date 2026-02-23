import type { Channel, IncomingMessage, MessageContent, MediaContent } from "clawkit:types";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export interface CliChannelConfig {
  promptString?: string;
}

export default function createCliChannel(config: CliChannelConfig): Channel {
  let messageCallback: ((msg: IncomingMessage) => void) | null = null;
  let rl: readline.Interface | null = null;
  let running = false;
  const prompt = config.promptString ?? "you> ";

  return {
    name: "cli",

    async connect() {
      rl = readline.createInterface({ input, output });
      running = true;

      (async () => {
        while (running && rl) {
          try {
            const line = await rl.question(prompt);
            if (!line.trim()) continue;
            if (line.trim() === "/quit" || line.trim() === "/exit") {
              running = false;
              rl.close();
              process.exit(0);
            }
            if (messageCallback) {
              messageCallback({
                id: crypto.randomUUID(),
                channel: "cli",
                sender: "user",
                senderName: "User",
                content: line,
                timestamp: new Date(),
                raw: { line },
              });
            }
          } catch {
            // readline closed
            running = false;
          }
        }
      })();
    },

    onMessage(callback) {
      messageCallback = callback;
    },

    async sendMessage(_to: string, content: MessageContent) {
      const reset = "\x1b[0m";
      const cyan = "\x1b[36m";
      output.write(`${cyan}assistant>${reset} ${content.text}\n`);
    },

    async sendMedia(_to: string, media: MediaContent) {
      output.write(`[Media: ${media.type} - ${media.filename ?? media.mimeType}]\n`);
    },

    async disconnect() {
      running = false;
      rl?.close();
    },
  };
}
