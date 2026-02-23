import type { Channel, ChannelConfig, IncomingMessage, MessageContent, MediaContent } from "clawkit:types";

export interface SlackChannelConfig {
  botToken?: string;
  appToken?: string;
  signingSecret?: string;
}

export default function createSlackChannel(config: SlackChannelConfig): Channel {
  const botToken = config.botToken || process.env.SLACK_BOT_TOKEN || "";
  const appToken = config.appToken || process.env.SLACK_APP_TOKEN || "";
  const signingSecret = config.signingSecret || process.env.SLACK_SIGNING_SECRET || "";

  let app: any = null;
  let messageCallback: ((msg: IncomingMessage) => void) | null = null;

  return {
    name: "slack",

    async connect() {
      if (!botToken) {
        throw new Error("Slack bot token required. Set SLACK_BOT_TOKEN or config.channels.slack.botToken");
      }

      const { App } = await import("@slack/bolt");
      app = new App({
        token: botToken,
        appToken,
        signingSecret,
        socketMode: true,
      });

      app.message(async ({ message, say }: any) => {
        if (message.subtype || message.bot_id) return;
        if (!messageCallback) return;

        messageCallback({
          id: message.ts,
          channel: "slack",
          sender: message.user,
          senderName: message.user,
          content: message.text ?? "",
          group: message.channel,
          replyTo: message.thread_ts,
          timestamp: new Date(parseFloat(message.ts) * 1000),
          raw: message,
        });
      });

      await app.start();
      console.log("Slack bot connected via Socket Mode");
    },

    onMessage(callback) {
      messageCallback = callback;
    },

    async sendMessage(to: string, content: MessageContent) {
      if (!app) throw new Error("Slack bot not connected");

      await app.client.chat.postMessage({
        channel: to,
        text: content.text,
        ...(content.replyTo ? { thread_ts: content.replyTo } : {}),
      });
    },

    async sendMedia(to: string, media: MediaContent) {
      if (!app) throw new Error("Slack bot not connected");

      const data = typeof media.data === "string"
        ? Buffer.from(media.data, "base64")
        : media.data;

      await app.client.files.uploadV2({
        channel_id: to,
        content: data,
        filename: media.filename ?? "file",
        title: media.caption ?? undefined,
      });
    },

    async disconnect() {
      if (app) {
        await app.stop();
        app = null;
      }
    },
  };
}
