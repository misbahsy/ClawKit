import { describe, it, expect, afterEach } from "vitest";
import { resolve } from "node:path";
import { WebSocket } from "ws";
import type { Channel, IPC } from "../../packages/core/src/types.js";

/**
 * Channel connectivity tests — local only, no external credentials.
 * Tests actual network transport (HTTP, WebSocket) for channels that can run locally.
 */

// Use dynamic ports to avoid conflicts
function getRandomPort(): number {
  return 10000 + Math.floor(Math.random() * 50000);
}

describe("Channel connectivity: webhook", () => {
  let channel: Channel & { getPort(): number };

  afterEach(async () => {
    if (channel) await channel.disconnect();
  });

  it("should start, receive POST, and return ok", async () => {
    const mod = await import(resolve(process.cwd(), "registry/channels/webhook/index.ts"));
    channel = mod.default({ port: 0, host: "127.0.0.1" });

    const receivedMessages: any[] = [];
    channel.onMessage((msg) => receivedMessages.push(msg));
    await channel.connect();

    const port = channel.getPort();
    expect(port).toBeGreaterThan(0);

    // POST a message
    const resp = await fetch(`http://127.0.0.1:${port}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender: "test", content: "hello webhook" }),
    });

    expect(resp.ok).toBe(true);
    const body = await resp.json();
    expect(body.ok).toBe(true);

    // Verify message was received
    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0].content).toBe("hello webhook");
    expect(receivedMessages[0].sender).toBe("test");
    expect(receivedMessages[0].channel).toBe("webhook");
  });

  it("should reject unauthorized requests when secret is set", async () => {
    const mod = await import(resolve(process.cwd(), "registry/channels/webhook/index.ts"));
    channel = mod.default({ port: 0, host: "127.0.0.1", secret: "test-secret" });
    await channel.connect();

    const port = channel.getPort();

    // No secret
    const resp1 = await fetch(`http://127.0.0.1:${port}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "no auth" }),
    });
    expect(resp1.status).toBe(401);

    // With correct secret
    const resp2 = await fetch(`http://127.0.0.1:${port}/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": "test-secret",
      },
      body: JSON.stringify({ content: "with auth" }),
    });
    expect(resp2.ok).toBe(true);
  });

  it("should serve health check", async () => {
    const mod = await import(resolve(process.cwd(), "registry/channels/webhook/index.ts"));
    channel = mod.default({ port: 0, host: "127.0.0.1" });
    await channel.connect();

    const port = channel.getPort();
    const resp = await fetch(`http://127.0.0.1:${port}/health`);
    expect(resp.ok).toBe(true);
    const body = await resp.json();
    expect(body.status).toBe("ok");
  });

  it("should store and retrieve responses", async () => {
    const mod = await import(resolve(process.cwd(), "registry/channels/webhook/index.ts"));
    channel = mod.default({ port: 0, host: "127.0.0.1" });
    await channel.connect();

    const port = channel.getPort();

    // Store a response via sendMessage
    await channel.sendMessage("resp-123", { text: "bot reply" });

    // Retrieve it
    const resp = await fetch(`http://127.0.0.1:${port}/response/resp-123`);
    expect(resp.ok).toBe(true);
    const body = await resp.json();
    expect(body.content.text).toBe("bot reply");
  });
});

describe("Channel connectivity: webchat", () => {
  let channel: Channel;
  let testPort: number;

  afterEach(async () => {
    if (channel) await channel.disconnect();
  });

  it("should accept WebSocket connection and exchange messages", async () => {
    testPort = getRandomPort();
    const mod = await import(resolve(process.cwd(), "registry/channels/webchat/index.ts"));
    channel = mod.default({ port: testPort, host: "127.0.0.1" });

    const receivedMessages: any[] = [];
    channel.onMessage((msg) => receivedMessages.push(msg));
    await channel.connect();

    // Connect via WebSocket
    const ws = new WebSocket(`ws://127.0.0.1:${testPort}`);
    await new Promise<void>((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
    });

    // Send a message from client
    ws.send(JSON.stringify({ sender: "ws-user", content: "hello webchat" }));

    // Wait for message to be processed
    await new Promise((r) => setTimeout(r, 200));

    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0].content).toBe("hello webchat");
    expect(receivedMessages[0].sender).toBe("ws-user");
    expect(receivedMessages[0].channel).toBe("webchat");

    // Send a bot message and verify client receives it
    const clientReceived: any[] = [];
    ws.on("message", (data) => {
      clientReceived.push(JSON.parse(data.toString()));
    });

    await channel.sendMessage("ws-user", { text: "bot says hi" });

    await new Promise((r) => setTimeout(r, 200));

    expect(clientReceived).toHaveLength(1);
    expect(clientReceived[0].text).toBe("bot says hi");

    ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  it("should serve HTML chat UI via HTTP", async () => {
    testPort = getRandomPort();
    const mod = await import(resolve(process.cwd(), "registry/channels/webchat/index.ts"));
    channel = mod.default({ port: testPort, host: "127.0.0.1" });
    await channel.connect();

    const resp = await fetch(`http://127.0.0.1:${testPort}`);
    expect(resp.ok).toBe(true);
    const html = await resp.text();
    expect(html).toContain("ClawKit Webchat");
    expect(html).toContain("<html");
  });
});

describe("Channel connectivity: ipc-http", () => {
  let ipc: IPC & { getPort(): number };

  afterEach(async () => {
    if (ipc) await ipc.stop();
  });

  it("should start server and handle send/receive", async () => {
    const mod = await import(resolve(process.cwd(), "registry/ipc/http/index.ts"));
    ipc = mod.default({ port: 0, host: "127.0.0.1" });
    await ipc.start();

    const port = ipc.getPort();
    expect(port).toBeGreaterThan(0);

    // Register a handler
    const received: any[] = [];
    ipc.onReceive("test-channel", (payload) => {
      received.push(payload);
    });

    // Send a message directly via HTTP
    const resp = await fetch(`http://127.0.0.1:${port}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "msg-1",
        channel: "test-channel",
        payload: { data: "hello ipc" },
        timestamp: new Date().toISOString(),
      }),
    });

    expect(resp.ok).toBe(true);
    const body = await resp.json();
    expect(body.ok).toBe(true);

    expect(received).toHaveLength(1);
    expect(received[0].data).toBe("hello ipc");
  });

  it("should send messages to target URL", async () => {
    // Start two IPC instances — one as server, one targeting it
    const mod = await import(resolve(process.cwd(), "registry/ipc/http/index.ts"));

    const server: IPC & { getPort(): number } = mod.default({
      port: 0,
      host: "127.0.0.1",
    });
    await server.start();
    const serverPort = server.getPort();

    const client: IPC & { getPort(): number } = mod.default({
      port: 0,
      host: "127.0.0.1",
      targetUrl: `http://127.0.0.1:${serverPort}`,
    });
    await client.start();

    const received: any[] = [];
    server.onReceive("relay", (payload) => {
      received.push(payload);
    });

    // Client sends to server
    await client.send("relay", { message: "from client" });

    await new Promise((r) => setTimeout(r, 200));

    expect(received).toHaveLength(1);
    expect(received[0].message).toBe("from client");

    await client.stop();
    await server.stop();
    // Prevent double-stop in afterEach
    ipc = null as any;
  });
});

describe("Channels requiring tokens (skipped)", () => {
  const tokenChannels = [
    "slack",
    "discord",
    "telegram",
    "whatsapp",
    "signal",
    "email",
    "teams",
    "google-chat",
    "matrix",
    "mattermost",
    "irc",
    "lark",
    "dingtalk",
    "qq",
    "zalo",
    "sms",
    "imessage",
  ];

  for (const name of tokenChannels) {
    it.skip(`${name}: requires external token/credentials`, () => {
      // These channels require real tokens and external services.
      // They are skipped by default but documented here for completeness.
    });
  }
});
