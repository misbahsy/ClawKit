import type { Channel, ChannelConfig, IncomingMessage, MessageContent, MediaContent } from "clawkit:types";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";

export interface IMessageChannelConfig {
  pollInterval?: number;
  useBlueBubbles?: boolean;
  blueBubblesUrl?: string;
  blueBubblesPassword?: string;
}

function runAppleScript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", script], (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

export default function createIMessageChannel(config: IMessageChannelConfig): Channel {
  const pollInterval = config.pollInterval ?? 5000;
  const useBlueBubbles = config.useBlueBubbles ?? false;
  const blueBubblesUrl = config.blueBubblesUrl || process.env.BLUEBUBBLES_URL || "http://localhost:1234";
  const blueBubblesPassword = config.blueBubblesPassword || process.env.BLUEBUBBLES_PASSWORD || "";

  let messageCallback: ((msg: IncomingMessage) => void) | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastMessageDate: number = Date.now();
  let connected = false;

  async function pollAppleScript(): Promise<void> {
    if (!messageCallback) return;

    try {
      const script = `tell application "Messages"
        set msgs to {}
        repeat with c in text chats
          repeat with m in messages of c
            set end of msgs to (date received of m as string) & "|" & (handle of m as string) & "|" & (text of m as string)
          end repeat
        end repeat
        return msgs as string
      end tell`;

      const output = await runAppleScript(script);
      if (!output) return;

      const lines = output.split(",").map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        const [dateStr, sender, ...textParts] = line.split("|");
        const text = textParts.join("|");
        const msgDate = new Date(dateStr).getTime();

        if (msgDate <= lastMessageDate) continue;
        lastMessageDate = msgDate;

        messageCallback({
          id: randomUUID(),
          channel: "imessage",
          sender: sender ?? "unknown",
          senderName: sender ?? "unknown",
          content: text ?? "",
          timestamp: new Date(msgDate),
          raw: { dateStr, sender, text },
        });
      }
    } catch {
      // Polling errors are non-fatal
    }
  }

  async function pollBlueBubbles(): Promise<void> {
    if (!messageCallback) return;

    try {
      const since = new Date(lastMessageDate).toISOString();
      const url = `${blueBubblesUrl}/api/v1/message?after=${encodeURIComponent(since)}&password=${encodeURIComponent(blueBubblesPassword)}`;

      const response = await fetch(url);
      if (!response.ok) return;

      const data = await response.json() as any;
      const messages = data.data ?? data ?? [];

      for (const msg of messages) {
        const msgDate = msg.dateCreated ?? Date.now();
        if (msgDate <= lastMessageDate) continue;
        lastMessageDate = msgDate;

        const sender = msg.handle?.address ?? msg.sender ?? "unknown";

        messageCallback({
          id: msg.guid ?? randomUUID(),
          channel: "imessage",
          sender,
          senderName: msg.handle?.firstName ?? sender,
          content: msg.text ?? "",
          group: msg.chats?.[0]?.guid,
          groupName: msg.chats?.[0]?.displayName,
          timestamp: new Date(msgDate),
          raw: msg,
        });
      }
    } catch {
      // Polling errors are non-fatal
    }
  }

  return {
    name: "imessage",

    async connect(_config?: ChannelConfig) {
      if (process.platform !== "darwin" && !useBlueBubbles) {
        throw new Error("iMessage channel requires macOS or BlueBubbles bridge. Set useBlueBubbles: true for non-macOS.");
      }

      lastMessageDate = Date.now();
      connected = true;

      const pollFn = useBlueBubbles ? pollBlueBubbles : pollAppleScript;
      pollTimer = setInterval(() => pollFn(), pollInterval);

      console.log(`iMessage channel connected via ${useBlueBubbles ? "BlueBubbles" : "AppleScript"}`);
    },

    onMessage(callback) {
      messageCallback = callback;
    },

    async sendMessage(to: string, content: MessageContent) {
      if (!connected) throw new Error("iMessage channel not connected");

      if (useBlueBubbles) {
        const url = `${blueBubblesUrl}/api/v1/message/text?password=${encodeURIComponent(blueBubblesPassword)}`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatGuid: to,
            message: content.text,
          }),
        });

        if (!response.ok) {
          throw new Error(`BlueBubbles send failed: ${response.status}`);
        }
      } else {
        const escaped = content.text.replace(/"/g, '\\"');
        const script = `tell application "Messages"
          set targetBuddy to buddy "${to}" of service 1
          send "${escaped}" to targetBuddy
        end tell`;

        await runAppleScript(script);
      }
    },

    async sendMedia(to: string, media: MediaContent) {
      if (!connected) throw new Error("iMessage channel not connected");

      if (useBlueBubbles) {
        const url = `${blueBubblesUrl}/api/v1/message/attachment?password=${encodeURIComponent(blueBubblesPassword)}`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatGuid: to,
            name: media.filename ?? "file",
            data: typeof media.data === "string" ? media.data : Buffer.from(media.data).toString("base64"),
          }),
        });

        if (!response.ok) {
          throw new Error(`BlueBubbles attachment send failed: ${response.status}`);
        }
      } else {
        // AppleScript does not natively support sending files via Messages scripting
        // Fall back to sending caption text
        if (media.caption) {
          await this.sendMessage(to, { text: media.caption });
        }
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
