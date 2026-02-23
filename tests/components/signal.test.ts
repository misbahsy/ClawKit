import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process
const mockStdout = {
  on: vi.fn(),
};
const mockStdin = {
  write: vi.fn(),
};
const mockDaemon = {
  stdout: mockStdout,
  stdin: mockStdin,
  stderr: { on: vi.fn() },
  on: vi.fn(),
  kill: vi.fn(),
  killed: false,
};

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => mockDaemon),
}));

import createSignalChannel from "../../registry/channels/signal/index.js";

describe("signal", () => {
  let channel: ReturnType<typeof createSignalChannel>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDaemon.killed = false;
    channel = createSignalChannel({
      signalCliPath: "/usr/local/bin/signal-cli",
      phoneNumber: "+1234567890",
      configDir: "/tmp/signal",
    });
  });

  it("should have correct channel name", () => {
    expect(channel.name).toBe("signal");
  });

  it("should connect and spawn signal-cli daemon", async () => {
    const { spawn } = await import("node:child_process");
    await channel.connect({});

    expect(spawn).toHaveBeenCalledWith(
      "/usr/local/bin/signal-cli",
      expect.arrayContaining(["--config", "/tmp/signal", "-a", "+1234567890", "jsonRpc"]),
      expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
    );
    expect(mockStdout.on).toHaveBeenCalledWith("data", expect.any(Function));
  });

  it("should throw without phone number", async () => {
    const noPhone = createSignalChannel({ phoneNumber: "" });
    await expect(noPhone.connect({})).rejects.toThrow("phone number required");
  });

  it("should parse incoming JSON-RPC messages", async () => {
    let dataHandler: Function;
    mockStdout.on.mockImplementation((event: string, handler: Function) => {
      if (event === "data") dataHandler = handler;
    });

    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));
    await channel.connect({});

    // Simulate signal-cli JSON-RPC output
    const jsonRpc = JSON.stringify({
      jsonrpc: "2.0",
      method: "receive",
      params: {
        envelope: {
          source: "+9876543210",
          sourceName: "Alice",
          timestamp: 1700000000000,
          dataMessage: {
            message: "Hello from Signal",
            timestamp: 1700000000000,
          },
        },
      },
    });

    dataHandler!(Buffer.from(jsonRpc + "\n"));

    expect(received).toHaveLength(1);
    expect(received[0].content).toBe("Hello from Signal");
    expect(received[0].channel).toBe("signal");
    expect(received[0].sender).toBe("+9876543210");
    expect(received[0].senderName).toBe("Alice");
  });

  it("should parse group messages with attachments", async () => {
    let dataHandler: Function;
    mockStdout.on.mockImplementation((event: string, handler: Function) => {
      if (event === "data") dataHandler = handler;
    });

    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));
    await channel.connect({});

    const jsonRpc = JSON.stringify({
      jsonrpc: "2.0",
      method: "receive",
      params: {
        envelope: {
          source: "+1111111111",
          sourceName: "Bob",
          timestamp: 1700000001000,
          dataMessage: {
            message: "Check this out",
            groupInfo: { groupId: "group-abc" },
            attachments: [
              { contentType: "image/png", id: "att-1", filename: "photo.png" },
            ],
          },
        },
      },
    });

    dataHandler!(Buffer.from(jsonRpc + "\n"));

    expect(received).toHaveLength(1);
    expect(received[0].group).toBe("group-abc");
    expect(received[0].media).toHaveLength(1);
    expect(received[0].media[0].type).toBe("image");
    expect(received[0].media[0].mimeType).toBe("image/png");
  });

  it("should send messages via stdin JSON-RPC", async () => {
    await channel.connect({});
    await channel.sendMessage("+9876543210", { text: "Hello back!" });

    expect(mockStdin.write).toHaveBeenCalledWith(
      expect.stringContaining('"method":"send"'),
    );
    const written = mockStdin.write.mock.calls[0][0];
    const parsed = JSON.parse(written.trim());
    expect(parsed.params.recipient).toEqual(["+9876543210"]);
    expect(parsed.params.message).toBe("Hello back!");
  });

  it("should send messages with reply quote", async () => {
    await channel.connect({});
    await channel.sendMessage("+9876543210", { text: "Reply", replyTo: "1700000000000" });

    const written = mockStdin.write.mock.calls[0][0];
    const parsed = JSON.parse(written.trim());
    expect(parsed.params.quoteTimestamp).toBe(1700000000000);
  });

  it("should disconnect by killing daemon", async () => {
    await channel.connect({});
    await channel.disconnect();

    expect(mockDaemon.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
