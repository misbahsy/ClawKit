import type { Channel, ChannelConfig, IncomingMessage, MessageContent, MediaContent } from "clawkit:types";
import { createClient, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";

export interface MatrixChannelConfig {
  homeserverUrl?: string;
  accessToken?: string;
  userId?: string;
}

export default function createMatrixChannel(config: MatrixChannelConfig): Channel {
  const homeserverUrl = config.homeserverUrl || process.env.MATRIX_HOMESERVER_URL || "";
  const accessToken = config.accessToken || process.env.MATRIX_ACCESS_TOKEN || "";
  const userId = config.userId || process.env.MATRIX_USER_ID || "";

  let client: MatrixClient | null = null;
  let messageCallback: ((msg: IncomingMessage) => void) | null = null;

  function parseRoomMessage(event: MatrixEvent, room: Room | null): IncomingMessage | null {
    const sender = event.getSender();
    if (!sender || sender === userId) return null;

    const content = event.getContent();
    if (!content || content.msgtype !== "m.text") return null;

    const body = content.body ?? "";
    if (!body) return null;

    const roomId = room?.roomId ?? event.getRoomId() ?? "";
    const roomName = room?.name ?? undefined;

    const relatesTo = content["m.relates_to"];
    const replyTo = relatesTo?.["m.in_reply_to"]?.event_id ?? undefined;

    return {
      id: event.getId() ?? String(Date.now()),
      channel: "matrix",
      sender,
      senderName: room?.getMember(sender)?.name ?? sender,
      content: body,
      group: roomId,
      groupName: roomName,
      replyTo,
      timestamp: new Date(event.getTs()),
      raw: event,
    };
  }

  return {
    name: "matrix",

    async connect() {
      if (!homeserverUrl) {
        throw new Error("Matrix homeserver URL required. Set MATRIX_HOMESERVER_URL or config.channels.matrix.homeserverUrl");
      }
      if (!accessToken) {
        throw new Error("Matrix access token required. Set MATRIX_ACCESS_TOKEN or config.channels.matrix.accessToken");
      }

      client = createClient({
        baseUrl: homeserverUrl,
        accessToken,
        userId,
      });

      client.on("Room.timeline" as any, (event: MatrixEvent, room: Room | null) => {
        if (!messageCallback) return;
        if (event.getType() !== "m.room.message") return;

        const parsed = parseRoomMessage(event, room);
        if (parsed) {
          messageCallback(parsed);
        }
      });

      await client.startClient({ initialSyncLimit: 0 });
      console.log(`Matrix client connected as ${userId}`);
    },

    onMessage(callback) {
      messageCallback = callback;
    },

    async sendMessage(to: string, content: MessageContent) {
      if (!client) throw new Error("Matrix client not connected");

      await client.sendTextMessage(to, content.text);
    },

    async sendMedia(to: string, media: MediaContent) {
      if (!client) throw new Error("Matrix client not connected");

      const data = typeof media.data === "string"
        ? Buffer.from(media.data, "base64")
        : media.data;

      const uploaded = await client.uploadContent(data, {
        type: media.mimeType,
        name: media.filename ?? "file",
      });

      const msgtype = media.type === "image" ? "m.image"
        : media.type === "audio" ? "m.audio"
        : media.type === "video" ? "m.video"
        : "m.file";

      await client.sendMessage(to, {
        msgtype,
        body: media.caption ?? media.filename ?? "file",
        url: uploaded.content_uri,
        info: { mimetype: media.mimeType },
      });
    },

    async disconnect() {
      if (client) {
        client.stopClient();
        client = null;
      }
    },
  };
}
