import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PassThrough } from "node:stream";
import createStdioIPC from "../../registry/ipc/stdio/index.js";

describe("ipc-stdio", () => {
  let inputStream: PassThrough;
  let outputStream: PassThrough;
  let ipc: ReturnType<typeof createStdioIPC>;

  beforeEach(async () => {
    inputStream = new PassThrough();
    outputStream = new PassThrough();
    ipc = createStdioIPC({
      inputStream: inputStream as any,
      outputStream: outputStream as any,
      requestTimeout: 2000,
    });
  });

  afterEach(async () => {
    await ipc.stop();
    inputStream.destroy();
    outputStream.destroy();
  });

  it("should have the correct name", () => {
    expect(ipc.name).toBe("ipc-stdio");
  });

  it("should write JSON lines to output on send", async () => {
    const written: string[] = [];
    outputStream.on("data", (chunk: Buffer) => {
      written.push(chunk.toString());
    });

    await ipc.send("test-channel", { text: "hello" });

    await new Promise((r) => setTimeout(r, 50));

    expect(written.length).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(written.join("").trim());
    expect(parsed.channel).toBe("test-channel");
    expect(parsed.payload).toEqual({ text: "hello" });
    expect(parsed.id).toBeTruthy();
    expect(parsed.timestamp).toBeTruthy();
  });

  it("should receive JSON lines from input", async () => {
    const received: any[] = [];

    ipc.onReceive("my-channel", (payload) => {
      received.push(payload);
    });

    await ipc.start();

    const msg = JSON.stringify({
      id: "test-1",
      channel: "my-channel",
      payload: { data: "from-stdin" },
      timestamp: new Date().toISOString(),
    });

    inputStream.write(msg + "\n");

    await new Promise((r) => setTimeout(r, 100));

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ data: "from-stdin" });
  });

  it("should handle multiple channels independently", async () => {
    const ch1: any[] = [];
    const ch2: any[] = [];

    ipc.onReceive("channel-1", (p) => ch1.push(p));
    ipc.onReceive("channel-2", (p) => ch2.push(p));

    await ipc.start();

    inputStream.write(JSON.stringify({
      id: "m1", channel: "channel-1", payload: "msg1", timestamp: new Date().toISOString(),
    }) + "\n");

    inputStream.write(JSON.stringify({
      id: "m2", channel: "channel-2", payload: "msg2", timestamp: new Date().toISOString(),
    }) + "\n");

    await new Promise((r) => setTimeout(r, 100));

    expect(ch1).toHaveLength(1);
    expect(ch1[0]).toBe("msg1");
    expect(ch2).toHaveLength(1);
    expect(ch2[0]).toBe("msg2");
  });

  it("should skip malformed JSON lines", async () => {
    const received: any[] = [];

    ipc.onReceive("ch", (p) => received.push(p));
    await ipc.start();

    inputStream.write("not json at all\n");
    inputStream.write(JSON.stringify({
      id: "ok", channel: "ch", payload: "valid", timestamp: new Date().toISOString(),
    }) + "\n");

    await new Promise((r) => setTimeout(r, 100));

    expect(received).toHaveLength(1);
    expect(received[0]).toBe("valid");
  });

  it("should handle request/response via correlationId", async () => {
    await ipc.start();

    // Capture what's written to stdout (the request)
    const written: string[] = [];
    outputStream.on("data", (chunk: Buffer) => {
      written.push(chunk.toString());
    });

    // Start request, then simulate a response coming in via stdin
    const requestPromise = ipc.request("req-channel", { query: "test" }, 2000);

    await new Promise((r) => setTimeout(r, 50));

    // Parse the outgoing request to get the correlationId
    const outgoing = JSON.parse(written[written.length - 1].trim());
    expect(outgoing.correlationId).toBeTruthy();

    // Simulate response via stdin
    inputStream.write(JSON.stringify({
      id: "resp-1",
      channel: "req-channel",
      payload: { answer: 42 },
      correlationId: outgoing.correlationId,
      isResponse: true,
      timestamp: new Date().toISOString(),
    }) + "\n");

    const result = await requestPromise;
    expect(result).toEqual({ answer: 42 });
  });

  it("should timeout on request with no response", async () => {
    await ipc.start();

    await expect(
      ipc.request("no-responder", { query: "test" }, 200),
    ).rejects.toThrow("timeout");
  });

  it("should stop cleanly and reject pending requests", async () => {
    await ipc.start();

    const requestPromise = ipc.request("ch", { data: "test" }, 5000);

    await new Promise((r) => setTimeout(r, 50));
    await ipc.stop();

    await expect(requestPromise).rejects.toThrow("IPC stopped");
  });

  it("should handle partial lines buffering", async () => {
    const received: any[] = [];

    ipc.onReceive("ch", (p) => received.push(p));
    await ipc.start();

    const msg = JSON.stringify({
      id: "partial", channel: "ch", payload: "buffered", timestamp: new Date().toISOString(),
    });

    // Write in two chunks
    const half = Math.floor(msg.length / 2);
    inputStream.write(msg.slice(0, half));
    await new Promise((r) => setTimeout(r, 30));
    inputStream.write(msg.slice(half) + "\n");

    await new Promise((r) => setTimeout(r, 100));

    expect(received).toHaveLength(1);
    expect(received[0]).toBe("buffered");
  });

  it("should not process messages after stop", async () => {
    const received: any[] = [];

    ipc.onReceive("ch", (p) => received.push(p));
    await ipc.start();
    await ipc.stop();

    inputStream.write(JSON.stringify({
      id: "late", channel: "ch", payload: "too-late", timestamp: new Date().toISOString(),
    }) + "\n");

    await new Promise((r) => setTimeout(r, 100));

    expect(received).toHaveLength(0);
  });
});
