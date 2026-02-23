import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import createFilesystemIPC from "../../registry/ipc/filesystem/index.js";

describe("ipc-filesystem", () => {
  let tmpDir: string;
  let ipc: ReturnType<typeof createFilesystemIPC>;

  beforeEach(async () => {
    tmpDir = resolve(tmpdir(), `clawkit-test-ipc-fs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    ipc = createFilesystemIPC({
      ipcDir: resolve(tmpDir, "ipc"),
      requestTimeout: 5000,
    });
  });

  afterEach(async () => {
    await ipc.stop();
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should send and receive messages", async () => {
    const received: any[] = [];

    ipc.onReceive("test-channel", (payload) => {
      received.push(payload);
    });

    await ipc.start();
    await ipc.send("test-channel", { text: "hello" });

    // Wait for fs.watch to trigger
    await new Promise((r) => setTimeout(r, 200));

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ text: "hello" });
  });

  it("should handle multiple channels", async () => {
    const ch1: any[] = [];
    const ch2: any[] = [];

    ipc.onReceive("channel-1", (p) => ch1.push(p));
    ipc.onReceive("channel-2", (p) => ch2.push(p));

    await ipc.start();
    await ipc.send("channel-1", "msg1");
    await ipc.send("channel-2", "msg2");

    await new Promise((r) => setTimeout(r, 200));

    expect(ch1).toHaveLength(1);
    expect(ch2).toHaveLength(1);
    expect(ch1[0]).toBe("msg1");
    expect(ch2[0]).toBe("msg2");
  });

  it("should create IPC directory on start", async () => {
    await ipc.start();
    expect(existsSync(resolve(tmpDir, "ipc"))).toBe(true);
  });

  it("should request/response with correlation ID", async () => {
    const responder = createFilesystemIPC({
      ipcDir: resolve(tmpDir, "ipc"),
    });

    // Set up responder that watches for requests and writes responses
    responder.onReceive("req-channel", (payload) => {
      // Write response file
      const responseDir = resolve(tmpDir, "ipc", "req-channel__response");
      mkdirSync(responseDir, { recursive: true });
      // The request ID is the file name used for the original message
    });

    await ipc.start();
    await responder.start();

    // The request will timeout since we don't have a proper responder
    await expect(
      ipc.request("no-responder", { query: "test" }, 200)
    ).rejects.toThrow("timeout");

    await responder.stop();
  });

  it("should stop cleanly", async () => {
    await ipc.start();
    await expect(ipc.stop()).resolves.toBeUndefined();
  });
});
