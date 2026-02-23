import type { Channel, IncomingMessage, MessageContent, MediaContent } from "clawkit:types";
import { makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } from "baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import qrcodeTerminal from "qrcode-terminal";
import { mkdirSync } from "node:fs";

export interface WhatsAppChannelConfig {
  authDir?: string;
}

export default function createWhatsAppChannel(config: WhatsAppChannelConfig): Channel {
  const authDir = config.authDir ?? "./data/whatsapp-auth";
  let messageCallback: ((msg: IncomingMessage) => void) | null = null;
  let sock: ReturnType<typeof makeWASocket> | null = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_DELAY = 30000;
  let shouldReconnect = true;

  function getReconnectDelay(): number {
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
    reconnectAttempts++;
    return delay;
  }

  function markdownToWhatsApp(text: string): string {
    return text
      .replace(/\*\*(.+?)\*\*/g, "*$1*")       // bold
      .replace(/(?<!\*)__(.+?)__(?!\*)/g, "_$1_") // italic
      .replace(/~~(.+?)~~/g, "~$1~")             // strikethrough
      .replace(/```[\s\S]*?```/g, (m) => m)      // preserve code blocks
      .replace(/(?<!`)`([^`]+)`(?!`)/g, "```$1```"); // inline code
  }

  async function connectSocket(): Promise<void> {
    mkdirSync(authDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const logger = pino({ level: "silent" });

    sock = makeWASocket({
      auth: state,
      logger,
      printQRInTerminal: false,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log("\nScan this QR code with WhatsApp:\n");
        qrcodeTerminal.generate(qr, { small: true });
      }

      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        if (loggedOut) {
          console.error("WhatsApp logged out. Delete auth directory and re-scan.");
          shouldReconnect = false;
          return;
        }

        if (shouldReconnect) {
          const delay = getReconnectDelay();
          console.log(`WhatsApp disconnected. Reconnecting in ${delay}ms...`);
          setTimeout(() => connectSocket(), delay);
        }
      }

      if (connection === "open") {
        reconnectAttempts = 0;
        console.log("WhatsApp connected!");
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;

      for (const msg of messages) {
        if (!msg.message || msg.key.fromMe) continue;

        const sender = msg.key.remoteJid ?? "";
        const isGroup = sender.endsWith("@g.us");
        const participant = msg.key.participant ?? sender;

        let textContent = "";
        const mediaAttachments: IncomingMessage["media"] = [];

        const m = msg.message;

        if (m.conversation) {
          textContent = m.conversation;
        } else if (m.extendedTextMessage) {
          textContent = m.extendedTextMessage.text ?? "";
        } else if (m.imageMessage) {
          textContent = m.imageMessage.caption ?? "";
          try {
            const buffer = await downloadMediaMessage(msg, "buffer", {});
            mediaAttachments.push({
              type: "image",
              buffer: buffer as Buffer,
              mimeType: m.imageMessage.mimetype ?? "image/jpeg",
            });
          } catch { /* media download failed */ }
        } else if (m.audioMessage) {
          try {
            const buffer = await downloadMediaMessage(msg, "buffer", {});
            mediaAttachments.push({
              type: "audio",
              buffer: buffer as Buffer,
              mimeType: m.audioMessage.mimetype ?? "audio/ogg",
            });
          } catch { /* media download failed */ }
        } else if (m.documentMessage) {
          textContent = m.documentMessage.caption ?? "";
          try {
            const buffer = await downloadMediaMessage(msg, "buffer", {});
            mediaAttachments.push({
              type: "document",
              buffer: buffer as Buffer,
              mimeType: m.documentMessage.mimetype ?? "application/octet-stream",
              filename: m.documentMessage.fileName ?? undefined,
            });
          } catch { /* media download failed */ }
        } else if (m.videoMessage) {
          textContent = m.videoMessage.caption ?? "";
          try {
            const buffer = await downloadMediaMessage(msg, "buffer", {});
            mediaAttachments.push({
              type: "video",
              buffer: buffer as Buffer,
              mimeType: m.videoMessage.mimetype ?? "video/mp4",
            });
          } catch { /* media download failed */ }
        }

        if (!textContent && mediaAttachments.length === 0) continue;

        const replyTo = m.extendedTextMessage?.contextInfo?.quotedMessage
          ? m.extendedTextMessage.contextInfo.stanzaId
          : undefined;

        const senderName = msg.pushName ?? participant.split("@")[0];

        if (messageCallback) {
          messageCallback({
            id: msg.key.id ?? crypto.randomUUID(),
            channel: "whatsapp",
            sender: participant,
            senderName,
            content: textContent,
            media: mediaAttachments.length > 0 ? mediaAttachments : undefined,
            group: isGroup ? sender : undefined,
            groupName: isGroup ? sender.split("@")[0] : undefined,
            replyTo,
            timestamp: new Date((msg.messageTimestamp as number) * 1000),
            raw: msg,
          });
        }
      }
    });
  }

  return {
    name: "whatsapp",

    async connect() {
      shouldReconnect = true;
      await connectSocket();
    },

    onMessage(callback) {
      messageCallback = callback;
    },

    async sendMessage(to: string, content: MessageContent) {
      if (!sock) throw new Error("WhatsApp not connected");

      const text = markdownToWhatsApp(content.text);

      if (content.replyTo) {
        await sock.sendMessage(to, { text }, { quoted: { key: { id: content.replyTo, remoteJid: to }, message: {} } as any });
      } else {
        await sock.sendMessage(to, { text });
      }
    },

    async sendMedia(to: string, media: MediaContent) {
      if (!sock) throw new Error("WhatsApp not connected");

      const buffer = typeof media.data === "string" ? Buffer.from(media.data, "base64") : media.data;

      switch (media.type) {
        case "image":
          await sock.sendMessage(to, {
            image: buffer,
            caption: media.caption,
            mimetype: media.mimeType,
          });
          break;
        case "audio":
          await sock.sendMessage(to, {
            audio: buffer,
            mimetype: media.mimeType,
          });
          break;
        case "video":
          await sock.sendMessage(to, {
            video: buffer,
            caption: media.caption,
            mimetype: media.mimeType,
          });
          break;
        case "document":
          await sock.sendMessage(to, {
            document: buffer,
            fileName: media.filename ?? "file",
            mimetype: media.mimeType,
            caption: media.caption,
          });
          break;
      }
    },

    async disconnect() {
      shouldReconnect = false;
      if (sock) {
        sock.ev.removeAllListeners("messages.upsert");
        sock.ev.removeAllListeners("connection.update");
        sock.ev.removeAllListeners("creds.update");
        sock.end(undefined);
        sock = null;
      }
    },
  };
}
