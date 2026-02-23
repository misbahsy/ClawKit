import type { Channel, ChannelConfig, IncomingMessage, MessageContent, MediaContent } from "clawkit:types";
import { randomUUID } from "node:crypto";

export interface QQChannelConfig {
  httpUrl?: string;
  accessToken?: string;
  pollInterval?: number;
}

export default function createQQChannel(config: QQChannelConfig): Channel {
  const httpUrl = config.httpUrl || process.env.QQ_HTTP_URL || "http://localhost:5700";
  const accessToken = config.accessToken || process.env.QQ_ACCESS_TOKEN || "";
  const pollInterval = config.pollInterval ?? 3000;

  let messageCallback: ((msg: IncomingMessage) => void) | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let connected = false;
  let lastMessageId: number = 0;

  function authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (accessToken) {
      headers["Authorization"] = `Bearer ${accessToken}`;
    }
    return headers;
  }

  async function pollMessages(): Promise<void> {
    if (!messageCallback) return;

    try {
      const url = `${httpUrl}/get_latest_messages`;
      const response = await fetch(url, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ count: 20 }),
      });

      if (!response.ok) return;

      const data = await response.json() as any;
      const messages = data.data?.messages ?? data.data ?? [];

      for (const msg of messages) {
        const msgId = msg.message_id ?? 0;
        if (msgId <= lastMessageId) continue;
        lastMessageId = msgId;

        const isGroup = msg.message_type === "group";
        const sender = String(msg.user_id ?? msg.sender?.user_id ?? "unknown");
        const senderName = msg.sender?.nickname ?? msg.sender?.card ?? sender;

        messageCallback({
          id: String(msgId),
          channel: "qq",
          sender,
          senderName,
          content: msg.raw_message ?? msg.message ?? "",
          group: isGroup ? String(msg.group_id) : undefined,
          groupName: isGroup ? msg.group_name : undefined,
          timestamp: msg.time ? new Date(msg.time * 1000) : new Date(),
          raw: msg,
        });
      }
    } catch {
      // Polling errors are non-fatal
    }
  }

  return {
    name: "qq",

    async connect(_config?: ChannelConfig) {
      // Validate that go-cqhttp is reachable
      try {
        const response = await fetch(`${httpUrl}/get_login_info`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({}),
        });

        if (!response.ok) {
          throw new Error(`go-cqhttp not reachable at ${httpUrl}: ${response.status}`);
        }

        const data = await response.json() as any;
        console.log(`QQ channel connected as ${data.data?.nickname ?? "unknown"} (${data.data?.user_id ?? "?"})`);
      } catch (err: any) {
        throw new Error(`Failed to connect to go-cqhttp at ${httpUrl}: ${err.message}`);
      }

      connected = true;
      lastMessageId = 0;

      pollTimer = setInterval(() => pollMessages(), pollInterval);
    },

    onMessage(callback) {
      messageCallback = callback;
    },

    async sendMessage(to: string, content: MessageContent) {
      if (!connected) throw new Error("QQ channel not connected");

      // Determine if sending to group or private
      const isGroup = to.startsWith("group:");
      const targetId = isGroup ? to.replace("group:", "") : to;

      const url = `${httpUrl}/send_msg`;
      const body: any = {
        message: content.text,
      };

      if (isGroup) {
        body.group_id = Number(targetId);
        body.message_type = "group";
      } else {
        body.user_id = Number(targetId);
        body.message_type = "private";
      }

      const response = await fetch(url, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`QQ send failed: ${response.status} ${err}`);
      }
    },

    async sendMedia(to: string, media: MediaContent) {
      if (!connected) throw new Error("QQ channel not connected");

      // go-cqhttp supports CQ codes for images
      let cqMessage = "";

      if (media.type === "image" && typeof media.data === "string") {
        if (media.data.startsWith("http")) {
          cqMessage = `[CQ:image,file=${media.data}]`;
        } else {
          cqMessage = `[CQ:image,file=base64://${media.data}]`;
        }
      } else if (typeof media.data === "string" && media.data.startsWith("http")) {
        cqMessage = `[CQ:image,file=${media.data}]`;
      } else {
        // Fallback to text for unsupported media
        cqMessage = media.caption ?? `[${media.type}: ${media.filename ?? "file"}]`;
      }

      if (media.caption) {
        cqMessage = `${media.caption}\n${cqMessage}`;
      }

      await this.sendMessage(to, { text: cqMessage });
    },

    async disconnect() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      connected = false;
    },
  };
}
