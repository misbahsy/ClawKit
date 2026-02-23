import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import createWebchatChannel from "../../registry/channels/webchat/index.js";

function getRandomPort(): number {
  return 10000 + Math.floor(Math.random() * 50000);
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });
}

function waitForMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve) => {
    ws.once("message", (data) => {
      resolve(JSON.parse(data.toString()));
    });
  });
}

describe("webchat", () => {
  let channel: ReturnType<typeof createWebchatChannel>;
  let port: number;

  beforeEach(() => {
    port = getRandomPort();
    channel = createWebchatChannel({ port, host: "127.0.0.1" });
  });

  afterEach(async () => {
    await channel.disconnect();
  });

  it("should have correct channel name", () => {
    expect(channel.name).toBe("webchat");
  });

  it("should connect and accept WebSocket connections", async () => {
    await channel.connect({});

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await waitForOpen(ws);

    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("should receive messages from WebSocket clients", async () => {
    await channel.connect({});

    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await waitForOpen(ws);

    ws.send(JSON.stringify({ sender: "user-1", content: "Hello webchat" }));

    // Wait for message to propagate
    await new Promise((r) => setTimeout(r, 100));

    expect(received).toHaveLength(1);
    expect(received[0].content).toBe("Hello webchat");
    expect(received[0].channel).toBe("webchat");
    expect(received[0].sender).toBe("user-1");

    ws.close();
  });

  it("should broadcast sendMessage to connected clients", async () => {
    await channel.connect({});

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await waitForOpen(ws);

    const msgPromise = waitForMessage(ws);
    await channel.sendMessage("user-1", { text: "Reply from bot" });

    const msg = await msgPromise;
    expect(msg.text).toBe("Reply from bot");

    ws.close();
  });

  it("should handle sendMedia by broadcasting metadata", async () => {
    await channel.connect({});

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await waitForOpen(ws);

    const msgPromise = waitForMessage(ws);
    await channel.sendMedia("user-1", {
      type: "image",
      data: "aGVsbG8=",
      mimeType: "image/png",
      filename: "photo.png",
      caption: "A photo",
    });

    const msg = await msgPromise;
    expect(msg.text).toBe("A photo");
    expect(msg.filename).toBe("photo.png");

    ws.close();
  });

  it("should disconnect and close all connections", async () => {
    await channel.connect({});

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await waitForOpen(ws);

    const closePromise = new Promise<void>((resolve) => {
      ws.on("close", () => resolve());
    });

    await channel.disconnect();
    await closePromise;

    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });

  it("should ignore malformed WebSocket messages", async () => {
    await channel.connect({});

    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await waitForOpen(ws);

    ws.send("not valid json {{{");

    await new Promise((r) => setTimeout(r, 100));
    expect(received).toHaveLength(0);

    ws.close();
  });
});
