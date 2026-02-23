import type { Channel, ChannelConfig, IncomingMessage, MessageContent, MediaContent } from "clawkit:types";
import { randomUUID } from "node:crypto";

export interface LarkChannelConfig {
  appId?: string;
  appSecret?: string;
  verificationToken?: string;
  pollInterval?: number;
}

export default function createLarkChannel(config: LarkChannelConfig): Channel {
  const appId = config.appId || process.env.LARK_APP_ID || "";
  const appSecret = config.appSecret || process.env.LARK_APP_SECRET || "";
  const verificationToken = config.verificationToken || process.env.LARK_VERIFICATION_TOKEN || "";
  const pollInterval = config.pollInterval ?? 5000;

  let messageCallback: ((msg: IncomingMessage) => void) | null = null;
  let tenantAccessToken: string = "";
  let tokenExpiry: number = 0;
  let connected = false;

  const baseUrl = "https://open.feishu.cn/open-apis";

  async function refreshToken(): Promise<void> {
    if (Date.now() < tokenExpiry && tenantAccessToken) return;

    const response = await fetch(`${baseUrl}/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });

    if (!response.ok) {
      throw new Error(`Lark token refresh failed: ${response.status}`);
    }

    const data = await response.json() as any;
    if (data.code !== 0) {
      throw new Error(`Lark token error: ${data.msg}`);
    }

    tenantAccessToken = data.tenant_access_token;
    // Token expires in ~2h; refresh early at 90% of expiry
    tokenExpiry = Date.now() + (data.expire ?? 7200) * 900;
  }

  function authHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${tenantAccessToken}`,
    };
  }

  return {
    name: "lark",

    async connect(_config?: ChannelConfig) {
      if (!appId) {
        throw new Error("Lark app ID required. Set LARK_APP_ID or config.channels.lark.appId");
      }
      if (!appSecret) {
        throw new Error("Lark app secret required. Set LARK_APP_SECRET or config.channels.lark.appSecret");
      }

      await refreshToken();
      connected = true;

      console.log("Lark channel connected");
    },

    onMessage(callback) {
      messageCallback = callback;
    },

    handleEvent(event: any): void {
      if (!messageCallback) return;

      // Lark Event v2 message format
      const header = event.header ?? {};
      const eventBody = event.event ?? {};

      if (header.event_type !== "im.message.receive_v1") return;

      const msg = eventBody.message ?? {};
      const sender = eventBody.sender?.sender_id?.open_id ?? "unknown";
      const senderName = eventBody.sender?.sender_id?.name ?? sender;

      let content = "";
      try {
        const parsed = JSON.parse(msg.content ?? "{}");
        content = parsed.text ?? "";
      } catch {
        content = msg.content ?? "";
      }

      const chatType = msg.chat_type ?? "p2p";
      const isGroup = chatType === "group";

      messageCallback({
        id: msg.message_id ?? randomUUID(),
        channel: "lark",
        sender,
        senderName,
        content,
        group: isGroup ? msg.chat_id : undefined,
        replyTo: msg.root_id ?? msg.parent_id,
        timestamp: new Date(Number(msg.create_time ?? Date.now())),
        raw: event,
      });
    },

    async sendMessage(to: string, content: MessageContent) {
      if (!connected) throw new Error("Lark channel not connected");

      await refreshToken();

      const body: any = {
        receive_id: to,
        msg_type: "text",
        content: JSON.stringify({ text: content.text }),
      };

      const url = `${baseUrl}/im/v1/messages?receive_id_type=chat_id`;

      const response = await fetch(url, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Lark send failed: ${response.status} ${err}`);
      }
    },

    async sendMedia(to: string, media: MediaContent) {
      if (!connected) throw new Error("Lark channel not connected");

      await refreshToken();

      // Lark requires uploading media first, then sending as image/file message
      // For simplicity, send as a text message with caption
      const text = media.caption ?? `[${media.type}: ${media.filename ?? "file"}]`;

      const body = {
        receive_id: to,
        msg_type: "text",
        content: JSON.stringify({ text }),
      };

      const url = `${baseUrl}/im/v1/messages?receive_id_type=chat_id`;

      const response = await fetch(url, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Lark media send failed: ${response.status} ${err}`);
      }
    },

    async disconnect() {
      connected = false;
      tenantAccessToken = "";
      tokenExpiry = 0;
    },
  } as Channel & { handleEvent(event: any): void };
}
