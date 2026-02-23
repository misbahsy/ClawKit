import type { Channel, ChannelConfig, IncomingMessage, MessageContent, MediaContent } from "clawkit:types";
import { Client as IrcClient } from "irc-framework";

export interface IrcChannelConfig {
  server?: string;
  port?: number;
  nickname?: string;
  channels?: string[];
  tls?: boolean;
  password?: string;
}

export default function createIrcChannel(config: IrcChannelConfig): Channel {
  const server = config.server || process.env.IRC_SERVER || "";
  const port = config.port ?? (config.tls ? 6697 : 6667);
  const nickname = config.nickname || process.env.IRC_NICKNAME || "";
  const ircChannels = config.channels ?? [];
  const tls = config.tls ?? false;
  const password = config.password || process.env.IRC_PASSWORD || undefined;

  let client: IrcClient | null = null;
  let messageCallback: ((msg: IncomingMessage) => void) | null = null;

  return {
    name: "irc",

    async connect() {
      if (!server) {
        throw new Error("IRC server required. Set IRC_SERVER or config.channels.irc.server");
      }
      if (!nickname) {
        throw new Error("IRC nickname required. Set IRC_NICKNAME or config.channels.irc.nickname");
      }

      client = new IrcClient();

      await new Promise<void>((resolve, reject) => {
        client!.connect({
          host: server,
          port,
          nick: nickname,
          tls,
          password,
        });

        client!.on("registered", () => {
          // Join all configured channels
          for (const chan of ircChannels) {
            client!.join(chan);
          }
          resolve();
        });

        client!.on("error", (err: any) => {
          reject(new Error(`IRC connection error: ${err.message ?? err}`));
        });

        // Timeout after 30 seconds
        setTimeout(() => reject(new Error("IRC connection timeout")), 30000);
      });

      client.on("message", (event: any) => {
        if (!messageCallback) return;
        if (event.nick === nickname) return;

        const isChannel = event.target?.startsWith("#") || event.target?.startsWith("&");

        const msg: IncomingMessage = {
          id: `${Date.now()}-${event.nick}`,
          channel: "irc",
          sender: event.nick ?? "unknown",
          senderName: event.nick ?? "unknown",
          content: event.message ?? "",
          group: isChannel ? event.target : undefined,
          groupName: isChannel ? event.target : undefined,
          timestamp: new Date(),
          raw: event,
        };

        if (msg.content) {
          messageCallback(msg);
        }
      });

      console.log(`IRC connected to ${server} as ${nickname}`);
    },

    onMessage(callback) {
      messageCallback = callback;
    },

    async sendMessage(to: string, content: MessageContent) {
      if (!client) throw new Error("IRC client not connected");

      // Split long messages into multiple lines (IRC has line length limits)
      const lines = content.text.split("\n");
      for (const line of lines) {
        if (line.trim()) {
          client.say(to, line);
        }
      }
    },

    async sendMedia(to: string, media: MediaContent) {
      if (!client) throw new Error("IRC client not connected");

      // IRC does not support file uploads; send caption or filename as text
      const text = media.caption ?? `[${media.type}: ${media.filename ?? "file"}]`;
      client.say(to, text);
    },

    async disconnect() {
      if (client) {
        client.quit("ClawKit disconnecting");
        client = null;
      }
    },
  };
}
