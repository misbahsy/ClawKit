import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import createUnixSocketIPC from "../../registry/ipc/unix-socket/index.js";

describe("ipc-unix-socket", () => {
  let ipc: ReturnType<typeof createUnixSocketIPC>;
  let socketPath: string;

  beforeEach(async () => {
    socketPath = resolve(tmpdir(), `clawkit-test-${randomUUID()}.sock`);
    ipc = createUnixSocketIPC({ socketPath, requestTimeout: 2000 });
  });

  afterEach(async () => {
    await ipc.stop();
  });

  it("should have the correct name", () => {
    expect(ipc.name).toBe("ipc-unix-socket");
  });

  it("should create socket file on start", async () => {
    await ipc.start();
    expect(existsSync(socketPath)).toBe(true);
  });

  it("should accept client connections", async () => {
    await ipc.start();

    return new Promise<void>((resolve, reject) => {
      const client = createConnection(socketPath, () => {
        client.destroy();
        resolve();
      });
      client.on("error", reject);
      setTimeout(() => reject(new Error("Timeout")), 3000);
    });
  });

  it("should broadcast messages to connected clients", async () => {
    await ipc.start();

    return new Promise<void>((resolve, reject) => {
      const client = createConnection(socketPath, () => {
        let data = "";
        client.on("data", (chunk) => {
          data += chunk.toString();
          const lines = data.split("\n").filter(Boolean);
          for (const line of lines) {
            try {
              const frame = JSON.parse(line);
              if (frame.channel === "test-ch") {
                expect(frame.payload).toEqual({ msg: "hello" });
                client.destroy();
                resolve();
              }
            } catch { /* partial line */ }
          }
        });

        // Send after connection established
        setTimeout(() => {
          ipc.send("test-ch", { msg: "hello" });
        }, 50);
      });

      client.on("error", reject);
      setTimeout(() => {
        client.destroy();
        reject(new Error("Timeout waiting for broadcast"));
      }, 3000);
    });
  });

  it("should receive messages from connected clients", async () => {
    const received: any[] = [];
    ipc.onReceive("incoming", (payload) => received.push(payload));

    await ipc.start();

    return new Promise<void>((resolve, reject) => {
      const client = createConnection(socketPath, () => {
        const frame = JSON.stringify({
          id: "msg-1",
          type: "message",
          channel: "incoming",
          payload: { data: "from-client" },
          timestamp: new Date().toISOString(),
        }) + "\n";

        client.write(frame);

        setTimeout(() => {
          expect(received).toHaveLength(1);
          expect(received[0]).toEqual({ data: "from-client" });
          client.destroy();
          resolve();
        }, 100);
      });

      client.on("error", reject);
      setTimeout(() => {
        client.destroy();
        reject(new Error("Timeout"));
      }, 3000);
    });
  });

  it("should handle multiple channels independently", async () => {
    const ch1: any[] = [];
    const ch2: any[] = [];
    ipc.onReceive("channel-1", (p) => ch1.push(p));
    ipc.onReceive("channel-2", (p) => ch2.push(p));

    await ipc.start();

    return new Promise<void>((resolve, reject) => {
      const client = createConnection(socketPath, () => {
        client.write(
          JSON.stringify({
            id: "m1", type: "message", channel: "channel-1",
            payload: "msg1", timestamp: new Date().toISOString(),
          }) + "\n",
        );
        client.write(
          JSON.stringify({
            id: "m2", type: "message", channel: "channel-2",
            payload: "msg2", timestamp: new Date().toISOString(),
          }) + "\n",
        );

        setTimeout(() => {
          expect(ch1).toHaveLength(1);
          expect(ch1[0]).toBe("msg1");
          expect(ch2).toHaveLength(1);
          expect(ch2[0]).toBe("msg2");
          client.destroy();
          resolve();
        }, 100);
      });

      client.on("error", reject);
      setTimeout(() => {
        client.destroy();
        reject(new Error("Timeout"));
      }, 3000);
    });
  });

  it("should skip malformed JSON lines", async () => {
    const received: any[] = [];
    ipc.onReceive("ch", (p) => received.push(p));

    await ipc.start();

    return new Promise<void>((resolve, reject) => {
      const client = createConnection(socketPath, () => {
        client.write("not json\n");
        client.write(
          JSON.stringify({
            id: "ok", type: "message", channel: "ch",
            payload: "valid", timestamp: new Date().toISOString(),
          }) + "\n",
        );

        setTimeout(() => {
          expect(received).toHaveLength(1);
          expect(received[0]).toBe("valid");
          client.destroy();
          resolve();
        }, 100);
      });

      client.on("error", reject);
      setTimeout(() => {
        client.destroy();
        reject(new Error("Timeout"));
      }, 3000);
    });
  });

  it("should handle request/response via correlationId", async () => {
    await ipc.start();

    // Connect a client that will respond to requests
    const client = createConnection(socketPath, () => {
      let buffer = "";
      client.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const frame = JSON.parse(line);
            if (frame.type === "request" && frame.correlationId) {
              // Send response
              const response = JSON.stringify({
                id: "resp-1",
                type: "response",
                channel: frame.channel,
                payload: { answer: 42 },
                correlationId: frame.correlationId,
                timestamp: new Date().toISOString(),
              }) + "\n";
              client.write(response);
            }
          } catch { /* ignore */ }
        }
      });
    });

    await new Promise((r) => setTimeout(r, 100));

    const result = await ipc.request("req-channel", { query: "test" }, 2000);
    expect(result).toEqual({ answer: 42 });

    client.destroy();
  });

  it("should timeout on request with no response", async () => {
    await ipc.start();

    await expect(
      ipc.request("no-responder", { query: "test" }, 200),
    ).rejects.toThrow("timeout");
  });

  it("should clean up socket file on stop", async () => {
    await ipc.start();
    expect(existsSync(socketPath)).toBe(true);

    await ipc.stop();
    expect(existsSync(socketPath)).toBe(false);
  });

  it("should reject pending requests on stop", async () => {
    await ipc.start();

    const requestPromise = ipc.request("ch", { data: "test" }, 5000);

    await new Promise((r) => setTimeout(r, 50));
    await ipc.stop();

    await expect(requestPromise).rejects.toThrow("IPC stopped");
  });
});
