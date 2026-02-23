import { describe, it, expect, beforeEach, afterEach } from "vitest";
import createHttpIPC from "../../registry/ipc/http/index.js";
import http from "node:http";

function postJson(url: string, body: any): Promise<any> {
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
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch {
            resolve(null);
          }
        });
      },
    );

    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

describe("ipc-http", () => {
  let ipc: ReturnType<typeof createHttpIPC> & { getPort(): number };

  beforeEach(async () => {
    ipc = createHttpIPC({
      port: 0, // random port
      host: "127.0.0.1",
      requestTimeout: 2000,
    }) as any;
    await ipc.start();
  });

  afterEach(async () => {
    await ipc.stop();
  });

  it("should have the correct name", () => {
    expect(ipc.name).toBe("ipc-http");
  });

  it("should start server on a port", () => {
    const port = ipc.getPort();
    expect(port).toBeGreaterThan(0);
  });

  it("should receive messages via HTTP POST", async () => {
    const received: any[] = [];
    const port = ipc.getPort();

    ipc.onReceive("test-channel", (payload) => {
      received.push(payload);
    });

    await postJson(`http://127.0.0.1:${port}/`, {
      id: "msg-1",
      channel: "test-channel",
      payload: { text: "hello" },
      timestamp: new Date().toISOString(),
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ text: "hello" });
  });

  it("should handle multiple channels", async () => {
    const ch1: any[] = [];
    const ch2: any[] = [];
    const port = ipc.getPort();

    ipc.onReceive("alpha", (p) => ch1.push(p));
    ipc.onReceive("beta", (p) => ch2.push(p));

    await postJson(`http://127.0.0.1:${port}/`, {
      id: "m1", channel: "alpha", payload: "a-msg", timestamp: new Date().toISOString(),
    });
    await postJson(`http://127.0.0.1:${port}/`, {
      id: "m2", channel: "beta", payload: "b-msg", timestamp: new Date().toISOString(),
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(ch1).toHaveLength(1);
    expect(ch1[0]).toBe("a-msg");
    expect(ch2).toHaveLength(1);
    expect(ch2[0]).toBe("b-msg");
  });

  it("should send messages to target via POST", async () => {
    // Set up a separate receiver server
    const receivedMessages: any[] = [];
    const receiver = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        try {
          receivedMessages.push(JSON.parse(Buffer.concat(chunks).toString()));
        } catch { /* ignore */ }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    await new Promise<void>((resolve) => {
      receiver.listen(0, "127.0.0.1", resolve);
    });

    const receiverPort = (receiver.address() as any).port;

    const sender = createHttpIPC({
      port: 0,
      targetUrl: `http://127.0.0.1:${receiverPort}`,
    });

    await sender.send("outgoing", { data: "sent" });

    await new Promise((r) => setTimeout(r, 100));

    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0].channel).toBe("outgoing");
    expect(receivedMessages[0].payload).toEqual({ data: "sent" });

    receiver.close();
  });

  it("should timeout on request with no response", async () => {
    const port = ipc.getPort();

    // Create a second IPC that targets this server
    const client = createHttpIPC({
      port: 0,
      targetUrl: `http://127.0.0.1:${port}`,
      requestTimeout: 200,
    });

    await expect(
      client.request("req-channel", { query: "test" }, 200),
    ).rejects.toThrow("timeout");
  });

  it("should stop cleanly", async () => {
    await expect(ipc.stop()).resolves.toBeUndefined();
  });

  it("should reject pending requests on stop", async () => {
    const port = ipc.getPort();

    const client = createHttpIPC({
      port: 0,
      targetUrl: `http://127.0.0.1:${port}`,
      requestTimeout: 5000,
    });
    await client.start();

    const reqPromise = client.request("ch", { data: "test" }, 5000);

    await new Promise((r) => setTimeout(r, 50));
    await client.stop();

    await expect(reqPromise).rejects.toThrow("IPC stopped");
  });
});
