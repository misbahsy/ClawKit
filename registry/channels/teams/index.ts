import type { Channel, ChannelConfig, IncomingMessage, MessageContent, MediaContent } from "clawkit:types";
import { BotFrameworkAdapter, TurnContext, type Activity } from "botframework-connector";

export interface TeamsChannelConfig {
  appId?: string;
  appPassword?: string;
  serviceUrl?: string;
}

export default function createTeamsChannel(config: TeamsChannelConfig): Channel {
  const appId = config.appId || process.env.TEAMS_APP_ID || "";
  const appPassword = config.appPassword || process.env.TEAMS_APP_PASSWORD || "";
  const serviceUrl = config.serviceUrl || process.env.TEAMS_SERVICE_URL || "https://smba.trafficmanager.net/teams/";

  let adapter: BotFrameworkAdapter | null = null;
  let messageCallback: ((msg: IncomingMessage) => void) | null = null;
  let conversationReferences: Map<string, any> = new Map();

  function parseActivity(activity: Activity): IncomingMessage | null {
    if (activity.type !== "message") return null;

    const text = activity.text ?? "";
    if (!text) return null;

    const sender = activity.from?.id ?? "unknown";
    const senderName = activity.from?.name ?? sender;

    const isGroup = activity.conversation?.isGroup ?? false;
    const group = isGroup ? activity.conversation?.id : undefined;
    const groupName = activity.conversation?.name ?? undefined;

    const media: IncomingMessage["media"] = [];
    if (activity.attachments) {
      for (const att of activity.attachments) {
        media.push({
          type: att.contentType?.startsWith("image/") ? "image"
            : att.contentType?.startsWith("audio/") ? "audio"
            : att.contentType?.startsWith("video/") ? "video"
            : "document",
          url: att.contentUrl ?? "",
          mimeType: att.contentType ?? "application/octet-stream",
          filename: att.name ?? undefined,
        });
      }
    }

    return {
      id: activity.id ?? String(Date.now()),
      channel: "teams",
      sender,
      senderName,
      content: text,
      media: media.length > 0 ? media : undefined,
      group,
      groupName,
      replyTo: activity.replyToId ?? undefined,
      timestamp: activity.timestamp ? new Date(activity.timestamp) : new Date(),
      raw: activity,
    };
  }

  return {
    name: "teams",

    async connect() {
      if (!appId) {
        throw new Error("Teams app ID required. Set TEAMS_APP_ID or config.channels.teams.appId");
      }
      if (!appPassword) {
        throw new Error("Teams app password required. Set TEAMS_APP_PASSWORD or config.channels.teams.appPassword");
      }

      adapter = new BotFrameworkAdapter({
        appId,
        appPassword,
      });

      // The adapter processes activities via processActivity() called from an HTTP endpoint.
      // Store a reference to the message handler for use in incoming webhooks.
      (adapter as any)._clawkitHandler = async (context: TurnContext) => {
        if (!messageCallback) return;

        const activity = context.activity;
        const parsed = parseActivity(activity);
        if (parsed) {
          // Store conversation reference for proactive messaging
          const ref = TurnContext.getConversationReference(activity);
          conversationReferences.set(activity.conversation?.id ?? parsed.sender, ref);
          messageCallback(parsed);
        }
      };

      console.log(`Teams channel initialized with app ${appId}`);
    },

    onMessage(callback) {
      messageCallback = callback;
    },

    async sendMessage(to: string, content: MessageContent) {
      if (!adapter) throw new Error("Teams adapter not initialized");

      const ref = conversationReferences.get(to);
      if (!ref) {
        throw new Error(`No conversation reference for ${to}. The user must message the bot first.`);
      }

      await adapter.continueConversation(ref, async (context: TurnContext) => {
        await context.sendActivity({
          type: "message",
          text: content.text,
          ...(content.replyTo ? { replyToId: content.replyTo } : {}),
        });
      });
    },

    async sendMedia(to: string, media: MediaContent) {
      if (!adapter) throw new Error("Teams adapter not initialized");

      const ref = conversationReferences.get(to);
      if (!ref) {
        throw new Error(`No conversation reference for ${to}`);
      }

      await adapter.continueConversation(ref, async (context: TurnContext) => {
        const data = typeof media.data === "string"
          ? Buffer.from(media.data, "base64")
          : media.data;

        await context.sendActivity({
          type: "message",
          text: media.caption ?? "",
          attachments: [{
            contentType: media.mimeType,
            contentUrl: `data:${media.mimeType};base64,${data.toString("base64")}`,
            name: media.filename ?? "file",
          }],
        });
      });
    },

    async disconnect() {
      conversationReferences.clear();
      adapter = null;
    },
  };
}
