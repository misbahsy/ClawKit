import type { Channel, IncomingMessage, MessageContent, MediaContent } from "clawkit:types";
import { Bot, type Context } from "grammy";

export interface TelegramChannelConfig {
  botToken?: string;
}

export default function createTelegramChannel(config: TelegramChannelConfig): Channel {
  const botToken = config.botToken || process.env.TELEGRAM_BOT_TOKEN || "";
  let bot: Bot | null = null;
  let messageCallback: ((msg: IncomingMessage) => void) | null = null;

  function parseMessage(ctx: Context): IncomingMessage | null {
    const msg = ctx.message;
    if (!msg) return null;

    const sender = String(msg.from?.id ?? "unknown");
    const senderName = msg.from?.first_name
      ? `${msg.from.first_name}${msg.from.last_name ? " " + msg.from.last_name : ""}`
      : sender;

    const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";
    const group = isGroup ? String(msg.chat.id) : undefined;
    const groupName = isGroup && "title" in msg.chat ? msg.chat.title : undefined;

    let content = "";
    const media: IncomingMessage["media"] = [];

    if (msg.text) {
      content = msg.text;
    } else if (msg.caption) {
      content = msg.caption;
    }

    if (msg.photo && msg.photo.length > 0) {
      const largest = msg.photo[msg.photo.length - 1];
      media.push({
        type: "image",
        url: largest.file_id,
        mimeType: "image/jpeg",
      });
    }

    if (msg.document) {
      media.push({
        type: "document",
        url: msg.document.file_id,
        mimeType: msg.document.mime_type ?? "application/octet-stream",
        filename: msg.document.file_name ?? undefined,
      });
    }

    if (msg.voice) {
      media.push({
        type: "audio",
        url: msg.voice.file_id,
        mimeType: msg.voice.mime_type ?? "audio/ogg",
      });
    }

    if (msg.video) {
      media.push({
        type: "video",
        url: msg.video.file_id,
        mimeType: msg.video.mime_type ?? "video/mp4",
      });
    }

    if (msg.sticker) {
      content = content || `[Sticker: ${msg.sticker.emoji ?? "unknown"}]`;
    }

    if (!content && media.length === 0) return null;

    const replyTo = msg.reply_to_message ? String(msg.reply_to_message.message_id) : undefined;

    return {
      id: String(msg.message_id),
      channel: "telegram",
      sender,
      senderName,
      content,
      media: media.length > 0 ? media : undefined,
      group,
      groupName,
      replyTo,
      timestamp: new Date(msg.date * 1000),
      raw: msg,
    };
  }

  return {
    name: "telegram",

    async connect() {
      if (!botToken) {
        throw new Error("Telegram bot token required. Set TELEGRAM_BOT_TOKEN or config.channels.telegram.botToken");
      }

      bot = new Bot(botToken);

      bot.on("message", (ctx) => {
        if (!messageCallback) return;
        const parsed = parseMessage(ctx);
        if (parsed) {
          messageCallback(parsed);
        }
      });

      bot.start({
        onStart: () => console.log("Telegram bot started"),
      });
    },

    onMessage(callback) {
      messageCallback = callback;
    },

    async sendMessage(to: string, content: MessageContent) {
      if (!bot) throw new Error("Telegram bot not connected");

      await bot.api.sendMessage(Number(to), content.text, {
        reply_to_message_id: content.replyTo ? Number(content.replyTo) : undefined,
        parse_mode: content.format === "markdown" ? "MarkdownV2" : undefined,
      });
    },

    async sendMedia(to: string, media: MediaContent) {
      if (!bot) throw new Error("Telegram bot not connected");

      const chatId = Number(to);
      const data = typeof media.data === "string" ? Buffer.from(media.data, "base64") : media.data;
      const inputFile = new (await import("grammy")).InputFile(data, media.filename);

      switch (media.type) {
        case "image":
          await bot.api.sendPhoto(chatId, inputFile, { caption: media.caption });
          break;
        case "audio":
          await bot.api.sendAudio(chatId, inputFile, { caption: media.caption });
          break;
        case "video":
          await bot.api.sendVideo(chatId, inputFile, { caption: media.caption });
          break;
        case "document":
          await bot.api.sendDocument(chatId, inputFile, { caption: media.caption });
          break;
      }
    },

    async disconnect() {
      if (bot) {
        bot.stop();
        bot = null;
      }
    },
  };
}
