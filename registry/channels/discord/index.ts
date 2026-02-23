import type { Channel, IncomingMessage, MessageContent, MediaContent } from "clawkit:types";
import { Client, GatewayIntentBits, type Message as DiscordMessage, AttachmentBuilder } from "discord.js";

export interface DiscordChannelConfig {
  botToken?: string;
  guildId?: string;
}

export default function createDiscordChannel(config: DiscordChannelConfig): Channel {
  const botToken = config.botToken || process.env.DISCORD_BOT_TOKEN || "";
  const guildId = config.guildId || process.env.DISCORD_GUILD_ID || "";
  let client: Client | null = null;
  let messageCallback: ((msg: IncomingMessage) => void) | null = null;

  function parseMessage(msg: DiscordMessage): IncomingMessage | null {
    if (msg.author.bot) return null;

    const sender = msg.author.id;
    const senderName = msg.author.displayName ?? msg.author.username;

    const isGuild = !!msg.guild;
    const group = isGuild ? msg.channelId : undefined;
    const groupName = isGuild && "name" in msg.channel ? (msg.channel as any).name : undefined;

    let content = msg.content ?? "";
    const media: IncomingMessage["media"] = [];

    for (const attachment of msg.attachments.values()) {
      const ct = attachment.contentType ?? "application/octet-stream";
      let type: "image" | "audio" | "video" | "document" = "document";
      if (ct.startsWith("image/")) type = "image";
      else if (ct.startsWith("audio/")) type = "audio";
      else if (ct.startsWith("video/")) type = "video";

      media.push({
        type,
        url: attachment.url,
        mimeType: ct,
        filename: attachment.name ?? undefined,
      });
    }

    if (!content && media.length === 0) return null;

    const replyTo = msg.reference?.messageId ?? undefined;

    return {
      id: msg.id,
      channel: "discord",
      sender,
      senderName,
      content,
      media: media.length > 0 ? media : undefined,
      group,
      groupName,
      replyTo,
      timestamp: msg.createdAt,
      raw: msg,
    };
  }

  return {
    name: "discord",

    async connect() {
      if (!botToken) {
        throw new Error("Discord bot token required. Set DISCORD_BOT_TOKEN or config.channels.discord.botToken");
      }

      client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.DirectMessages,
        ],
      });

      client.on("messageCreate", (msg) => {
        if (!messageCallback) return;
        if (guildId && msg.guild && msg.guild.id !== guildId) return;

        const parsed = parseMessage(msg);
        if (parsed) {
          messageCallback(parsed);
        }
      });

      await client.login(botToken);
      console.log(`Discord bot logged in as ${client.user?.tag}`);
    },

    onMessage(callback) {
      messageCallback = callback;
    },

    async sendMessage(to: string, content: MessageContent) {
      if (!client) throw new Error("Discord bot not connected");

      const channel = await client.channels.fetch(to);
      if (!channel || !("send" in channel)) {
        throw new Error(`Cannot send to channel ${to}`);
      }

      await (channel as any).send({
        content: content.text,
        reply: content.replyTo ? { messageReference: content.replyTo } : undefined,
      });
    },

    async sendMedia(to: string, media: MediaContent) {
      if (!client) throw new Error("Discord bot not connected");

      const channel = await client.channels.fetch(to);
      if (!channel || !("send" in channel)) {
        throw new Error(`Cannot send to channel ${to}`);
      }

      const data = typeof media.data === "string" ? Buffer.from(media.data, "base64") : media.data;
      const attachment = new AttachmentBuilder(data, { name: media.filename ?? "file" });

      await (channel as any).send({
        content: media.caption ?? "",
        files: [attachment],
      });
    },

    async disconnect() {
      if (client) {
        client.destroy();
        client = null;
      }
    },
  };
}
