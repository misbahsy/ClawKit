import type { Channel, ChannelConfig, IncomingMessage, MessageContent, MediaContent } from "clawkit:types";
import { randomUUID } from "node:crypto";

export interface ZaloChannelConfig {
  oaAccessToken?: string;
  oaSecretKey?: string;
}

export default function createZaloChannel(config: ZaloChannelConfig): Channel {
  const oaAccessToken = config.oaAccessToken || process.env.ZALO_OA_ACCESS_TOKEN || "";
  const oaSecretKey = config.oaSecretKey || process.env.ZALO_OA_SECRET_KEY || "";

  let messageCallback: ((msg: IncomingMessage) => void) | null = null;
  let connected = false;

  const baseUrl = "https://openapi.zalo.me/v3.0/oa";

  function authHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "access_token": oaAccessToken,
    };
  }

  return {
    name: "zalo",

    async connect(_config?: ChannelConfig) {
      if (!oaAccessToken) {
        throw new Error("Zalo OA access token required. Set ZALO_OA_ACCESS_TOKEN or config.channels.zalo.oaAccessToken");
      }

      // Validate token by calling getoa
      const response = await fetch(`${baseUrl}/getoa`, {
        headers: authHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Zalo OA token validation failed: ${response.status}`);
      }

      const data = await response.json() as any;
      if (data.error !== 0 && data.error !== undefined) {
        throw new Error(`Zalo OA error: ${data.message ?? "invalid token"}`);
      }

      connected = true;
      console.log("Zalo OA channel connected");
    },

    onMessage(callback) {
      messageCallback = callback;
    },

    handleEvent(event: any): void {
      if (!messageCallback) return;

      const eventName = event.event_name ?? "";
      if (eventName !== "user_send_text" && eventName !== "user_send_image" && eventName !== "user_send_file") {
        return;
      }

      const sender = event.sender?.id ?? event.user_id ?? "unknown";
      const content = event.message?.text ?? "";

      const media: IncomingMessage["media"] = [];
      if (event.message?.attachments) {
        for (const att of event.message.attachments) {
          const type = att.type === "image" ? "image"
            : att.type === "audio" ? "audio"
            : att.type === "video" ? "video"
            : "document";

          media.push({
            type: type as any,
            url: att.payload?.url,
            mimeType: att.payload?.type ?? "application/octet-stream",
          });
        }
      }

      messageCallback({
        id: event.message?.msg_id ?? randomUUID(),
        channel: "zalo",
        sender,
        senderName: event.sender?.name ?? sender,
        content,
        media: media.length > 0 ? media : undefined,
        timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
        raw: event,
      });
    },

    async sendMessage(to: string, content: MessageContent) {
      if (!connected) throw new Error("Zalo channel not connected");

      const url = `${baseUrl}/message/cs`;

      const body = {
        recipient: { user_id: to },
        message: { text: content.text },
      };

      const response = await fetch(url, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Zalo send failed: ${response.status} ${err}`);
      }

      const data = await response.json() as any;
      if (data.error !== 0 && data.error !== undefined) {
        throw new Error(`Zalo API error: ${data.message ?? "send failed"}`);
      }
    },

    async sendMedia(to: string, media: MediaContent) {
      if (!connected) throw new Error("Zalo channel not connected");

      // Zalo OA API supports image/file messages
      if (media.type === "image" && typeof media.data === "string" && media.data.startsWith("http")) {
        const url = `${baseUrl}/message/cs`;
        const body = {
          recipient: { user_id: to },
          message: {
            attachment: {
              type: "template",
              payload: {
                template_type: "media",
                elements: [{
                  media_type: "image",
                  url: media.data,
                }],
              },
            },
          },
        };

        const response = await fetch(url, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          throw new Error(`Zalo media send failed: ${response.status}`);
        }
        return;
      }

      // Fallback: send caption as text
      const text = media.caption ?? `[${media.type}: ${media.filename ?? "file"}]`;
      await this.sendMessage(to, { text });
    },

    async disconnect() {
      connected = false;
    },
  } as Channel & { handleEvent(event: any): void };
}
