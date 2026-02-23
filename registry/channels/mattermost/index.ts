import type { Channel, ChannelConfig, IncomingMessage, MessageContent, MediaContent } from "clawkit:types";
import { Client4, WebSocketClient } from "@mattermost/client";

export interface MattermostChannelConfig {
  serverUrl?: string;
  token?: string;
  teamId?: string;
}

export default function createMattermostChannel(config: MattermostChannelConfig): Channel {
  const serverUrl = config.serverUrl || process.env.MATTERMOST_SERVER_URL || "";
  const token = config.token || process.env.MATTERMOST_TOKEN || "";
  const teamId = config.teamId || process.env.MATTERMOST_TEAM_ID || "";

  let client: typeof Client4 | null = null;
  let wsClient: WebSocketClient | null = null;
  let messageCallback: ((msg: IncomingMessage) => void) | null = null;
  let currentUserId = "";

  function parsePostedEvent(data: any): IncomingMessage | null {
    try {
      const post = typeof data.post === "string" ? JSON.parse(data.post) : data.post;
      if (!post) return null;

      // Ignore own messages
      if (post.user_id === currentUserId) return null;

      const content = post.message ?? "";
      if (!content) return null;

      return {
        id: post.id,
        channel: "mattermost",
        sender: post.user_id,
        senderName: data.sender_name ?? post.user_id,
        content,
        group: post.channel_id,
        groupName: data.channel_display_name ?? undefined,
        replyTo: post.root_id || undefined,
        timestamp: new Date(post.create_at),
        raw: data,
      };
    } catch {
      return null;
    }
  }

  return {
    name: "mattermost",

    async connect() {
      if (!serverUrl) {
        throw new Error("Mattermost server URL required. Set MATTERMOST_SERVER_URL or config.channels.mattermost.serverUrl");
      }
      if (!token) {
        throw new Error("Mattermost token required. Set MATTERMOST_TOKEN or config.channels.mattermost.token");
      }

      Client4.setUrl(serverUrl);
      Client4.setToken(token);
      client = Client4;

      const me = await Client4.getMe();
      currentUserId = me.id;

      wsClient = new WebSocketClient();
      const wsUrl = serverUrl.replace(/^http/, "ws") + "/api/v4/websocket";
      wsClient.initialize(wsUrl, token);

      wsClient.addMessageListener((event: any) => {
        if (!messageCallback) return;
        if (event.event !== "posted") return;

        const parsed = parsePostedEvent(event.data);
        if (parsed) {
          messageCallback(parsed);
        }
      });

      console.log(`Mattermost channel connected as ${me.username}`);
    },

    onMessage(callback) {
      messageCallback = callback;
    },

    async sendMessage(to: string, content: MessageContent) {
      if (!client) throw new Error("Mattermost client not connected");

      await Client4.createPost({
        channel_id: to,
        message: content.text,
        root_id: content.replyTo ?? "",
      } as any);
    },

    async sendMedia(to: string, media: MediaContent) {
      if (!client) throw new Error("Mattermost client not connected");

      const data = typeof media.data === "string"
        ? Buffer.from(media.data, "base64")
        : media.data;

      const form = new FormData();
      const blob = new Blob([data], { type: media.mimeType });
      form.append("files", blob, media.filename ?? "file");
      form.append("channel_id", to);

      const uploaded = await Client4.uploadFile(form as any);
      const fileId = uploaded.file_infos?.[0]?.id;

      await Client4.createPost({
        channel_id: to,
        message: media.caption ?? "",
        file_ids: fileId ? [fileId] : [],
      } as any);
    },

    async disconnect() {
      if (wsClient) {
        wsClient.close();
        wsClient = null;
      }
      client = null;
    },
  };
}
