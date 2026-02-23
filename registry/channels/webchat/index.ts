import type { Channel, IncomingMessage, MessageContent, MediaContent } from "clawkit:types";
import { WebSocketServer, type WebSocket } from "ws";
import { createServer, type Server } from "node:http";

export interface WebchatChannelConfig {
  port?: number;
  host?: string;
}

const CHAT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ClawKit Webchat</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; height: 100vh; display: flex; flex-direction: column; background: #f5f5f5; }
    #messages { flex: 1; overflow-y: auto; padding: 1rem; display: flex; flex-direction: column; gap: 0.5rem; }
    .msg { max-width: 70%; padding: 0.5rem 0.75rem; border-radius: 0.75rem; line-height: 1.4; }
    .msg.user { align-self: flex-end; background: #0066ff; color: white; }
    .msg.bot { align-self: flex-start; background: white; border: 1px solid #ddd; }
    #input-bar { display: flex; padding: 0.75rem; gap: 0.5rem; background: white; border-top: 1px solid #ddd; }
    #input-bar input { flex: 1; padding: 0.5rem; border: 1px solid #ccc; border-radius: 0.5rem; font-size: 1rem; }
    #input-bar button { padding: 0.5rem 1rem; background: #0066ff; color: white; border: none; border-radius: 0.5rem; cursor: pointer; }
  </style>
</head>
<body>
  <div id="messages"></div>
  <div id="input-bar"><input id="msg" placeholder="Type a message..." autofocus /><button onclick="send()">Send</button></div>
  <script>
    const ws = new WebSocket(location.origin.replace(/^http/, 'ws'));
    const msgs = document.getElementById('messages');
    const input = document.getElementById('msg');
    const sender = 'user-' + Math.random().toString(36).slice(2, 8);
    ws.onmessage = (e) => { const d = JSON.parse(e.data); addMsg(d.text, 'bot'); };
    function addMsg(text, cls) { const el = document.createElement('div'); el.className = 'msg ' + cls; el.textContent = text; msgs.appendChild(el); msgs.scrollTop = msgs.scrollHeight; }
    function send() { const t = input.value.trim(); if (!t) return; addMsg(t, 'user'); ws.send(JSON.stringify({ sender, content: t })); input.value = ''; }
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  </script>
</body>
</html>`;

export default function createWebchatChannel(config: WebchatChannelConfig): Channel {
  const port = config.port ?? 3100;
  const host = config.host ?? "0.0.0.0";

  let httpServer: Server | null = null;
  let wss: WebSocketServer | null = null;
  let messageCallback: ((msg: IncomingMessage) => void) | null = null;
  const clients = new Set<WebSocket>();

  return {
    name: "webchat",

    async connect() {
      httpServer = createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(CHAT_HTML);
      });

      wss = new WebSocketServer({ server: httpServer });

      wss.on("connection", (ws) => {
        clients.add(ws);
        ws.on("close", () => clients.delete(ws));

        ws.on("message", (data) => {
          if (!messageCallback) return;

          try {
            const parsed = JSON.parse(data.toString());
            messageCallback({
              id: crypto.randomUUID(),
              channel: "webchat",
              sender: parsed.sender ?? "anonymous",
              content: parsed.content ?? "",
              timestamp: new Date(),
              raw: parsed,
            });
          } catch {
            // Ignore malformed messages
          }
        });
      });

      await new Promise<void>((resolve) => {
        httpServer!.listen(port, host, () => {
          console.log(`Webchat server running at http://${host}:${port}`);
          resolve();
        });
      });
    },

    onMessage(callback) {
      messageCallback = callback;
    },

    async sendMessage(to: string, content: MessageContent) {
      const payload = JSON.stringify({ text: content.text, to, replyTo: content.replyTo });
      for (const client of clients) {
        if (client.readyState === 1) {
          client.send(payload);
        }
      }
    },

    async sendMedia(to: string, media: MediaContent) {
      const payload = JSON.stringify({
        text: media.caption ?? `[${media.type}: ${media.filename ?? "file"}]`,
        to,
        mediaType: media.type,
        filename: media.filename,
      });
      for (const client of clients) {
        if (client.readyState === 1) {
          client.send(payload);
        }
      }
    },

    async disconnect() {
      for (const client of clients) {
        client.close();
      }
      clients.clear();

      if (wss) {
        wss.close();
        wss = null;
      }
      if (httpServer) {
        await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
        httpServer = null;
      }
    },
  };
}
