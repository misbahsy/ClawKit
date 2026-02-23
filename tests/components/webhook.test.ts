import { describe, it, expect, beforeEach, afterEach } from "vitest";
import createWebhookChannel from "../../registry/channels/webhook/index.js";
import http from "node:http";

function httpGet(url: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString();
        try {
          resolve({ status: res.statusCode!, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode!, body });
        }
      });
    }).on("error", reject);
  });
}

function httpPost(url: string, body: any, headers?: Record<string, string>): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);

    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          try {
            resolve({ status: res.statusCode!, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode!, body: raw });
          }
        });
      },
    );

    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

describe("webhook channel", () => {
  let channel: ReturnType<typeof createWebhookChannel> & { getPort(): number };

  beforeEach(async () => {
    channel = createWebhookChannel({ port: 0, host: "127.0.0.1" }) as any;
    await channel.connect();
  });

  afterEach(async () => {
    await channel.disconnect();
  });

  it("should have the correct name", () => {
    expect(channel.name).toBe("webhook");
  });

  it("should start server on a port", () => {
    const port = channel.getPort();
    expect(port).toBeGreaterThan(0);
  });

  it("should receive messages via POST /message", async () => {
    const received: any[] = [];
    const port = channel.getPort();

    channel.onMessage((msg) => {
      received.push(msg);
    });

    const resp = await httpPost(`http://127.0.0.1:${port}/message`, {
      sender: "external-service",
      senderName: "Service",
      content: "Hello from webhook",
    });

    expect(resp.status).toBe(200);
    expect(resp.body.ok).toBe(true);
    expect(resp.body.id).toBeTruthy();

    await new Promise((r) => setTimeout(r, 50));

    expect(received).toHaveLength(1);
    expect(received[0].channel).toBe("webhook");
    expect(received[0].sender).toBe("external-service");
    expect(received[0].content).toBe("Hello from webhook");
  });

  it("should assign default sender when not provided", async () => {
    const received: any[] = [];
    const port = channel.getPort();

    channel.onMessage((msg) => received.push(msg));

    await httpPost(`http://127.0.0.1:${port}/message`, {
      content: "No sender",
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(received[0].sender).toBe("webhook");
  });

  it("should handle both content and text fields", async () => {
    const received: any[] = [];
    const port = channel.getPort();

    channel.onMessage((msg) => received.push(msg));

    await httpPost(`http://127.0.0.1:${port}/message`, { text: "via text field" });

    await new Promise((r) => setTimeout(r, 50));

    expect(received[0].content).toBe("via text field");
  });

  it("should store response via sendMessage", async () => {
    const port = channel.getPort();

    await channel.sendMessage("resp-123", { text: "Here is the answer", format: "text" });

    const resp = await httpGet(`http://127.0.0.1:${port}/response/resp-123`);

    expect(resp.status).toBe(200);
    expect(resp.body.content.text).toBe("Here is the answer");
  });

  it("should return 404 for nonexistent response", async () => {
    const port = channel.getPort();

    const resp = await httpGet(`http://127.0.0.1:${port}/response/nonexistent`);
    expect(resp.status).toBe(404);
  });

  it("should consume response (only retrievable once)", async () => {
    const port = channel.getPort();

    await channel.sendMessage("one-time", { text: "once", format: "text" });

    const first = await httpGet(`http://127.0.0.1:${port}/response/one-time`);
    expect(first.status).toBe(200);

    const second = await httpGet(`http://127.0.0.1:${port}/response/one-time`);
    expect(second.status).toBe(404);
  });

  it("should return health check", async () => {
    const port = channel.getPort();

    const resp = await httpGet(`http://127.0.0.1:${port}/health`);
    expect(resp.status).toBe(200);
    expect(resp.body.status).toBe("ok");
    expect(resp.body.channel).toBe("webhook");
  });

  it("should return 404 for unknown routes", async () => {
    const port = channel.getPort();

    const resp = await httpGet(`http://127.0.0.1:${port}/unknown`);
    expect(resp.status).toBe(404);
  });

  it("should return 400 for malformed JSON POST", async () => {
    const port = channel.getPort();

    const resp = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/message",
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            resolve({
              status: res.statusCode!,
              body: JSON.parse(Buffer.concat(chunks).toString()),
            });
          });
        },
      );
      req.on("error", reject);
      req.write("not json at all{{{");
      req.end();
    });

    expect(resp.status).toBe(400);
  });

  it("should disconnect cleanly", async () => {
    await expect(channel.disconnect()).resolves.toBeUndefined();
  });

  it("should enforce secret when configured", async () => {
    await channel.disconnect();

    const secured = createWebhookChannel({
      port: 0,
      host: "127.0.0.1",
      secret: "my-secret-token",
    }) as any;
    await secured.connect();
    const port = secured.getPort();

    // Without secret
    const resp1 = await httpPost(`http://127.0.0.1:${port}/message`, { content: "test" });
    expect(resp1.status).toBe(401);

    // With wrong secret
    const resp2 = await httpPost(
      `http://127.0.0.1:${port}/message`,
      { content: "test" },
      { "x-webhook-secret": "wrong" },
    );
    expect(resp2.status).toBe(401);

    // With correct secret
    const resp3 = await httpPost(
      `http://127.0.0.1:${port}/message`,
      { content: "test" },
      { "x-webhook-secret": "my-secret-token" },
    );
    expect(resp3.status).toBe(200);

    // With Bearer auth
    const resp4 = await httpPost(
      `http://127.0.0.1:${port}/message`,
      { content: "test" },
      { Authorization: "Bearer my-secret-token" },
    );
    expect(resp4.status).toBe(200);

    await secured.disconnect();
  });
});
