import type { Channel, ChannelConfig, IncomingMessage, MessageContent, MediaContent } from "clawkit:types";
import { google, type chat_v1 } from "googleapis";

export interface GoogleChatChannelConfig {
  credentials?: string;
  spaceId?: string;
  pollInterval?: number;
}

export default function createGoogleChatChannel(config: GoogleChatChannelConfig): Channel {
  const credentials = config.credentials || process.env.GOOGLE_CHAT_CREDENTIALS || "";
  const spaceId = config.spaceId || process.env.GOOGLE_CHAT_SPACE_ID || "";
  const pollInterval = config.pollInterval ?? 5000;

  let chatApi: chat_v1.Chat | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let messageCallback: ((msg: IncomingMessage) => void) | null = null;
  let lastMessageTime: string | undefined;

  function parseMessage(message: chat_v1.Schema$Message): IncomingMessage | null {
    const text = message.text ?? "";
    if (!text) return null;

    const sender = message.sender?.name ?? "unknown";
    const senderName = message.sender?.displayName ?? sender;

    const spaceName = message.space?.name ?? "";
    const threadName = message.thread?.name ?? undefined;

    return {
      id: message.name ?? String(Date.now()),
      channel: "google-chat",
      sender,
      senderName,
      content: text,
      group: spaceName,
      groupName: message.space?.displayName ?? undefined,
      replyTo: threadName,
      timestamp: message.createTime ? new Date(message.createTime) : new Date(),
      raw: message,
    };
  }

  async function pollForMessages() {
    if (!chatApi || !messageCallback) return;

    try {
      const response = await chatApi.spaces.messages.list({
        parent: `spaces/${spaceId}`,
        orderBy: "createTime desc",
        pageSize: 10,
        filter: lastMessageTime ? `createTime > "${lastMessageTime}"` : undefined,
      });

      const messages = response.data.messages ?? [];
      // Process oldest first
      for (const message of messages.reverse()) {
        const parsed = parseMessage(message);
        if (parsed) {
          messageCallback(parsed);
        }
        if (message.createTime) {
          lastMessageTime = message.createTime;
        }
      }
    } catch (err) {
      console.error("Google Chat poll error:", err);
    }
  }

  return {
    name: "google-chat",

    async connect() {
      if (!credentials) {
        throw new Error("Google Chat credentials required. Set GOOGLE_CHAT_CREDENTIALS or config.channels['google-chat'].credentials");
      }
      if (!spaceId) {
        throw new Error("Google Chat space ID required. Set GOOGLE_CHAT_SPACE_ID or config.channels['google-chat'].spaceId");
      }

      const auth = new google.auth.GoogleAuth({
        keyFile: credentials,
        scopes: ["https://www.googleapis.com/auth/chat.bot"],
      });

      chatApi = google.chat({ version: "v1", auth });

      pollTimer = setInterval(() => pollForMessages(), pollInterval);
      await pollForMessages();

      console.log(`Google Chat channel connected for space ${spaceId}`);
    },

    onMessage(callback) {
      messageCallback = callback;
    },

    async sendMessage(to: string, content: MessageContent) {
      if (!chatApi) throw new Error("Google Chat not connected");

      await chatApi.spaces.messages.create({
        parent: to.startsWith("spaces/") ? to : `spaces/${to}`,
        requestBody: {
          text: content.text,
          ...(content.replyTo ? {
            thread: { name: content.replyTo },
          } : {}),
        },
      });
    },

    async sendMedia(to: string, media: MediaContent) {
      if (!chatApi) throw new Error("Google Chat not connected");

      // Google Chat API does not directly support file uploads via REST.
      // Send a text message with the caption as a fallback.
      await chatApi.spaces.messages.create({
        parent: to.startsWith("spaces/") ? to : `spaces/${to}`,
        requestBody: {
          text: media.caption ?? `[${media.type}: ${media.filename ?? "file"}]`,
        },
      });
    },

    async disconnect() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      chatApi = null;
    },
  };
}
