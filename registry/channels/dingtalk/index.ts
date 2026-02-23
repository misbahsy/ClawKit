import type { Channel, ChannelConfig, IncomingMessage, MessageContent, MediaContent } from "clawkit:types";
import { createHmac } from "node:crypto";
import { randomUUID } from "node:crypto";

export interface DingTalkChannelConfig {
  accessToken?: string;
  secret?: string;
  agentId?: string;
  webhookUrl?: string;
}

export default function createDingTalkChannel(config: DingTalkChannelConfig): Channel {
  const accessToken = config.accessToken || process.env.DINGTALK_ACCESS_TOKEN || "";
  const secret = config.secret || process.env.DINGTALK_SECRET || "";
  const agentId = config.agentId || process.env.DINGTALK_AGENT_ID || "";
  const webhookUrl = config.webhookUrl || process.env.DINGTALK_WEBHOOK_URL || "";

  let messageCallback: ((msg: IncomingMessage) => void) | null = null;
  let connected = false;

  function getSignedUrl(): string {
    const timestamp = Date.now();
    const stringToSign = `${timestamp}\n${secret}`;
    const hmac = createHmac("sha256", secret).update(stringToSign).digest("base64");
    const sign = encodeURIComponent(hmac);

    const base = webhookUrl || `https://oapi.dingtalk.com/robot/send?access_token=${accessToken}`;
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}timestamp=${timestamp}&sign=${sign}`;
  }

  function getWebhookUrl(): string {
    if (secret) return getSignedUrl();
    if (webhookUrl) return webhookUrl;
    return `https://oapi.dingtalk.com/robot/send?access_token=${accessToken}`;
  }

  return {
    name: "dingtalk",

    async connect(_config?: ChannelConfig) {
      if (!accessToken && !webhookUrl) {
        throw new Error("DingTalk access token or webhook URL required. Set DINGTALK_ACCESS_TOKEN or config.channels.dingtalk.accessToken");
      }

      connected = true;
      console.log("DingTalk channel connected");
    },

    onMessage(callback) {
      messageCallback = callback;
    },

    handleEvent(event: any): void {
      if (!messageCallback) return;

      const msgType = event.msgtype ?? "text";
      let content = "";

      if (msgType === "text") {
        content = event.text?.content ?? "";
      } else if (msgType === "richText") {
        content = event.content ?? "";
      }

      const sender = event.senderStaffId ?? event.senderId ?? event.senderNick ?? "unknown";
      const senderName = event.senderNick ?? sender;
      const isGroup = !!event.conversationType && event.conversationType === "2";

      messageCallback({
        id: event.msgId ?? randomUUID(),
        channel: "dingtalk",
        sender,
        senderName,
        content,
        group: isGroup ? event.conversationId : undefined,
        groupName: isGroup ? event.conversationTitle : undefined,
        timestamp: event.createAt ? new Date(event.createAt) : new Date(),
        raw: event,
      });
    },

    async sendMessage(to: string, content: MessageContent) {
      if (!connected) throw new Error("DingTalk channel not connected");

      const url = getWebhookUrl();

      const body = {
        msgtype: "text",
        text: { content: content.text },
        at: to ? { atUserIds: [to] } : undefined,
      };

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`DingTalk send failed: ${response.status} ${err}`);
      }

      const data = await response.json() as any;
      if (data.errcode !== 0) {
        throw new Error(`DingTalk API error: ${data.errmsg}`);
      }
    },

    async sendMedia(to: string, media: MediaContent) {
      if (!connected) throw new Error("DingTalk channel not connected");

      const url = getWebhookUrl();

      // DingTalk robot webhook supports markdown for images via URL
      if (media.type === "image" && typeof media.data === "string" && media.data.startsWith("http")) {
        const body = {
          msgtype: "markdown",
          markdown: {
            title: media.caption ?? "Image",
            text: `![${media.caption ?? "image"}](${media.data})`,
          },
        };

        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          throw new Error(`DingTalk media send failed: ${response.status}`);
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
