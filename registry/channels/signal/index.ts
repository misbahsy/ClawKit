import type { Channel, ChannelConfig, IncomingMessage, MessageContent, MediaContent } from "clawkit:types";
import { spawn, type ChildProcess } from "node:child_process";

export interface SignalChannelConfig {
  signalCliPath?: string;
  phoneNumber?: string;
  configDir?: string;
}

export default function createSignalChannel(config: SignalChannelConfig): Channel {
  const signalCliPath = config.signalCliPath || process.env.SIGNAL_CLI_PATH || "signal-cli";
  const phoneNumber = config.phoneNumber || process.env.SIGNAL_PHONE_NUMBER || "";
  const configDir = config.configDir || process.env.SIGNAL_CONFIG_DIR || "";

  let daemon: ChildProcess | null = null;
  let messageCallback: ((msg: IncomingMessage) => void) | null = null;

  function parseJsonRpcMessage(data: any): IncomingMessage | null {
    // signal-cli JSON-RPC envelope
    const envelope = data?.params?.envelope;
    if (!envelope) return null;

    const dataMessage = envelope.dataMessage;
    if (!dataMessage) return null;

    const content = dataMessage.message ?? "";
    const media: IncomingMessage["media"] = [];

    if (dataMessage.attachments && dataMessage.attachments.length > 0) {
      for (const att of dataMessage.attachments) {
        media.push({
          type: att.contentType?.startsWith("image/") ? "image"
            : att.contentType?.startsWith("audio/") ? "audio"
            : att.contentType?.startsWith("video/") ? "video"
            : "document",
          url: att.id ?? att.filename ?? "",
          mimeType: att.contentType ?? "application/octet-stream",
          filename: att.filename ?? undefined,
        });
      }
    }

    if (!content && media.length === 0) return null;

    const group = dataMessage.groupInfo?.groupId ?? undefined;

    return {
      id: String(envelope.timestamp),
      channel: "signal",
      sender: envelope.source ?? "unknown",
      senderName: envelope.sourceName ?? envelope.source ?? "unknown",
      content,
      media: media.length > 0 ? media : undefined,
      group,
      groupName: group ? `group-${group}` : undefined,
      replyTo: dataMessage.quote?.id ? String(dataMessage.quote.id) : undefined,
      timestamp: new Date(envelope.timestamp),
      raw: data,
    };
  }

  return {
    name: "signal",

    async connect() {
      if (!phoneNumber) {
        throw new Error("Signal phone number required. Set SIGNAL_PHONE_NUMBER or config.channels.signal.phoneNumber");
      }

      const args = ["-a", phoneNumber, "jsonRpc"];
      if (configDir) {
        args.unshift("--config", configDir);
      }

      daemon = spawn(signalCliPath, args, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let buffer = "";

      daemon.stdout!.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf-8");

        // Process complete JSON lines
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const data = JSON.parse(trimmed);
            if (!messageCallback) continue;
            const parsed = parseJsonRpcMessage(data);
            if (parsed) {
              messageCallback(parsed);
            }
          } catch {
            // Skip non-JSON output
          }
        }
      });

      daemon.on("error", (err) => {
        console.error("signal-cli daemon error:", err);
      });

      console.log(`Signal channel started for ${phoneNumber}`);
    },

    onMessage(callback) {
      messageCallback = callback;
    },

    async sendMessage(to: string, content: MessageContent) {
      if (!daemon || daemon.killed) throw new Error("Signal daemon not running");

      const request = JSON.stringify({
        jsonrpc: "2.0",
        method: "send",
        params: {
          recipient: [to],
          message: content.text,
          ...(content.replyTo ? { quoteTimestamp: Number(content.replyTo) } : {}),
        },
      });

      daemon.stdin!.write(request + "\n");
    },

    async sendMedia(to: string, media: MediaContent) {
      if (!daemon || daemon.killed) throw new Error("Signal daemon not running");

      const request = JSON.stringify({
        jsonrpc: "2.0",
        method: "send",
        params: {
          recipient: [to],
          message: media.caption ?? "",
          attachments: [media.filename ?? "file"],
        },
      });

      daemon.stdin!.write(request + "\n");
    },

    async disconnect() {
      if (daemon) {
        daemon.kill("SIGTERM");
        daemon = null;
      }
    },
  };
}
