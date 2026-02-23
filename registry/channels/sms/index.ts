import type { Channel, ChannelConfig, IncomingMessage, MessageContent, MediaContent } from "clawkit:types";
import { randomUUID } from "node:crypto";

export interface SmsChannelConfig {
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
  pollInterval?: number;
}

export default function createSmsChannel(config: SmsChannelConfig): Channel {
  const accountSid = config.accountSid || process.env.TWILIO_ACCOUNT_SID || "";
  const authToken = config.authToken || process.env.TWILIO_AUTH_TOKEN || "";
  const fromNumber = config.fromNumber || process.env.TWILIO_FROM_NUMBER || "";
  const pollInterval = config.pollInterval ?? 10000;

  let messageCallback: ((msg: IncomingMessage) => void) | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastMessageDate: string = new Date().toISOString();
  let connected = false;

  function getAuthHeader(): string {
    return "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  }

  async function pollMessages(): Promise<void> {
    if (!messageCallback) return;

    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json?DateSent>=${encodeURIComponent(lastMessageDate)}&To=${encodeURIComponent(fromNumber)}&PageSize=20`;

      const response = await fetch(url, {
        headers: { Authorization: getAuthHeader() },
      });

      if (!response.ok) return;

      const data = await response.json() as any;
      const messages = data.messages ?? [];

      for (const msg of messages) {
        const msgDate = msg.date_sent ?? msg.date_created;
        if (msgDate <= lastMessageDate) continue;
        lastMessageDate = msgDate;

        messageCallback({
          id: msg.sid ?? randomUUID(),
          channel: "sms",
          sender: msg.from ?? "unknown",
          senderName: msg.from ?? "unknown",
          content: msg.body ?? "",
          timestamp: new Date(msgDate),
          raw: msg,
        });
      }
    } catch {
      // Polling errors are non-fatal
    }
  }

  return {
    name: "sms",

    async connect(_config?: ChannelConfig) {
      if (!accountSid) {
        throw new Error("Twilio account SID required. Set TWILIO_ACCOUNT_SID or config.channels.sms.accountSid");
      }
      if (!authToken) {
        throw new Error("Twilio auth token required. Set TWILIO_AUTH_TOKEN or config.channels.sms.authToken");
      }
      if (!fromNumber) {
        throw new Error("Twilio from number required. Set TWILIO_FROM_NUMBER or config.channels.sms.fromNumber");
      }

      lastMessageDate = new Date().toISOString();
      connected = true;

      pollTimer = setInterval(() => pollMessages(), pollInterval);

      console.log(`SMS channel connected via Twilio (${fromNumber})`);
    },

    onMessage(callback) {
      messageCallback = callback;
    },

    async sendMessage(to: string, content: MessageContent) {
      if (!connected) throw new Error("SMS channel not connected");

      const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

      const body = new URLSearchParams({
        To: to,
        From: fromNumber,
        Body: content.text,
      });

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: getAuthHeader(),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Twilio send failed: ${response.status} ${err}`);
      }
    },

    async sendMedia(to: string, media: MediaContent) {
      if (!connected) throw new Error("SMS channel not connected");

      const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

      const params: Record<string, string> = {
        To: to,
        From: fromNumber,
      };

      if (media.caption) {
        params.Body = media.caption;
      }

      // Twilio MMS requires a public MediaUrl; base64 data must be hosted first
      // If data is a URL string, use it directly
      if (typeof media.data === "string" && media.data.startsWith("http")) {
        params.MediaUrl = media.data;
      }

      const body = new URLSearchParams(params);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: getAuthHeader(),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Twilio MMS send failed: ${response.status} ${err}`);
      }
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
