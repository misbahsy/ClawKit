import type { Channel, IncomingMessage, MessageContent, MediaContent } from "clawkit:types";

export interface EmailChannelConfig {
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
  user?: string;
  password?: string;
  pollInterval?: number;
}

export default function createEmailChannel(config: EmailChannelConfig): Channel {
  const imapHost = config.imapHost || process.env.EMAIL_IMAP_HOST || "";
  const imapPort = config.imapPort ?? 993;
  const smtpHost = config.smtpHost || process.env.EMAIL_SMTP_HOST || "";
  const smtpPort = config.smtpPort ?? 587;
  const user = config.user || process.env.EMAIL_USER || "";
  const password = config.password || process.env.EMAIL_PASSWORD || "";
  const pollInterval = config.pollInterval ?? 30000;

  let imapClient: any = null;
  let transporter: any = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let messageCallback: ((msg: IncomingMessage) => void) | null = null;
  let lastSeenUid = 0;

  async function pollForMessages() {
    if (!imapClient || !messageCallback) return;

    try {
      const lock = await imapClient.getMailboxLock("INBOX");
      try {
        const since = lastSeenUid > 0 ? `${lastSeenUid + 1}:*` : "*";
        for await (const msg of imapClient.fetch(since, {
          uid: true,
          envelope: true,
          source: true,
        })) {
          if (msg.uid <= lastSeenUid) continue;
          lastSeenUid = msg.uid;

          const from = msg.envelope.from?.[0];
          const sender = from ? `${from.name || ""}  <${from.address || ""}>`.trim() : "unknown";
          const subject = msg.envelope.subject ?? "";
          const body = msg.source?.toString("utf-8") ?? "";

          messageCallback({
            id: String(msg.uid),
            channel: "email",
            sender: from?.address ?? "unknown",
            senderName: from?.name ?? from?.address ?? "unknown",
            content: `Subject: ${subject}\n\n${body}`,
            timestamp: msg.envelope.date ? new Date(msg.envelope.date) : new Date(),
            raw: msg,
          });
        }
      } finally {
        lock.release();
      }
    } catch (err) {
      console.error("Email poll error:", err);
    }
  }

  return {
    name: "email",

    async connect() {
      if (!user) {
        throw new Error("Email user required. Set EMAIL_USER or config.channels.email.user");
      }

      const { ImapFlow } = await import("imapflow");
      const nodemailer = await import("nodemailer");

      imapClient = new ImapFlow({
        host: imapHost,
        port: imapPort,
        secure: true,
        auth: { user, pass: password },
        logger: false,
      });

      await imapClient.connect();

      transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user, pass: password },
      });

      pollTimer = setInterval(() => pollForMessages(), pollInterval);
      await pollForMessages();

      console.log(`Email channel connected as ${user}`);
    },

    onMessage(callback) {
      messageCallback = callback;
    },

    async sendMessage(to: string, content: MessageContent) {
      if (!transporter) throw new Error("Email not connected");

      await transporter.sendMail({
        from: user,
        to,
        subject: content.replyTo ? `Re: ${content.replyTo}` : "Message",
        text: content.text,
        html: content.format === "markdown" ? undefined : content.text,
      });
    },

    async sendMedia(to: string, media: MediaContent) {
      if (!transporter) throw new Error("Email not connected");

      const data = typeof media.data === "string"
        ? Buffer.from(media.data, "base64")
        : media.data;

      await transporter.sendMail({
        from: user,
        to,
        subject: media.caption ?? "Attachment",
        text: media.caption ?? "",
        attachments: [{
          filename: media.filename ?? "file",
          content: data,
          contentType: media.mimeType,
        }],
      });
    },

    async disconnect() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (imapClient) {
        await imapClient.logout();
        imapClient = null;
      }
      if (transporter) {
        transporter.close();
        transporter = null;
      }
    },
  };
}
