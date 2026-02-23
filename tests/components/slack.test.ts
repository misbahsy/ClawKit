import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @slack/bolt
const mockPostMessage = vi.fn().mockResolvedValue({});
const mockUploadV2 = vi.fn().mockResolvedValue({});
const mockStart = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn().mockResolvedValue(undefined);
let messageHandler: Function | null = null;

const mockApp = {
  client: {
    chat: { postMessage: mockPostMessage },
    files: { uploadV2: mockUploadV2 },
  },
  message: vi.fn((handler: Function) => {
    messageHandler = handler;
  }),
  start: mockStart,
  stop: mockStop,
};

vi.mock("@slack/bolt", () => ({
  App: vi.fn(() => mockApp),
}));

import createSlackChannel from "../../registry/channels/slack/index.js";

describe("slack", () => {
  let channel: ReturnType<typeof createSlackChannel>;

  beforeEach(() => {
    vi.clearAllMocks();
    messageHandler = null;
    channel = createSlackChannel({
      botToken: "xoxb-test-token",
      appToken: "xapp-test-token",
      signingSecret: "test-secret",
    });
  });

  it("should have correct channel name", () => {
    expect(channel.name).toBe("slack");
  });

  it("should connect and start the Bolt app", async () => {
    await channel.connect({});

    expect(mockApp.message).toHaveBeenCalledWith(expect.any(Function));
    expect(mockStart).toHaveBeenCalled();
  });

  it("should throw without bot token", async () => {
    const noToken = createSlackChannel({ botToken: "" });
    await expect(noToken.connect({})).rejects.toThrow("bot token required");
  });

  it("should parse incoming messages", async () => {
    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));
    await channel.connect({});

    // Simulate incoming Slack message via the message handler
    await messageHandler!({
      message: {
        ts: "1234567890.123456",
        user: "U12345",
        text: "Hello from Slack",
        channel: "C12345",
      },
      say: vi.fn(),
    });

    expect(received).toHaveLength(1);
    expect(received[0].content).toBe("Hello from Slack");
    expect(received[0].channel).toBe("slack");
    expect(received[0].sender).toBe("U12345");
    expect(received[0].group).toBe("C12345");
  });

  it("should ignore bot messages", async () => {
    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));
    await channel.connect({});

    await messageHandler!({
      message: {
        ts: "1234567890.123457",
        user: "U12345",
        text: "Bot message",
        channel: "C12345",
        bot_id: "B12345",
      },
      say: vi.fn(),
    });

    expect(received).toHaveLength(0);
  });

  it("should ignore subtype messages", async () => {
    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));
    await channel.connect({});

    await messageHandler!({
      message: {
        ts: "1234567890.123458",
        user: "U12345",
        text: "Edited",
        channel: "C12345",
        subtype: "message_changed",
      },
      say: vi.fn(),
    });

    expect(received).toHaveLength(0);
  });

  it("should send text messages", async () => {
    await channel.connect({});
    await channel.sendMessage("C12345", { text: "Hello Slack!" });

    expect(mockPostMessage).toHaveBeenCalledWith({
      channel: "C12345",
      text: "Hello Slack!",
    });
  });

  it("should send threaded replies", async () => {
    await channel.connect({});
    await channel.sendMessage("C12345", { text: "Reply", replyTo: "1234567890.111111" });

    expect(mockPostMessage).toHaveBeenCalledWith({
      channel: "C12345",
      text: "Reply",
      thread_ts: "1234567890.111111",
    });
  });

  it("should send media via file upload", async () => {
    await channel.connect({});
    await channel.sendMedia("C12345", {
      type: "image",
      data: "aGVsbG8=",
      mimeType: "image/png",
      filename: "test.png",
      caption: "A test image",
    });

    expect(mockUploadV2).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_id: "C12345",
        filename: "test.png",
        title: "A test image",
      }),
    );
  });

  it("should disconnect cleanly", async () => {
    await channel.connect({});
    await channel.disconnect();

    expect(mockStop).toHaveBeenCalled();
  });
});
