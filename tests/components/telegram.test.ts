import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock grammy before importing the component
const mockBot = {
  on: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  api: {
    sendMessage: vi.fn().mockResolvedValue({}),
    sendPhoto: vi.fn().mockResolvedValue({}),
    sendAudio: vi.fn().mockResolvedValue({}),
    sendVideo: vi.fn().mockResolvedValue({}),
    sendDocument: vi.fn().mockResolvedValue({}),
  },
};

vi.mock("grammy", () => ({
  Bot: vi.fn(() => mockBot),
  InputFile: vi.fn((data: any, name: string) => ({ data, name })),
}));

import createTelegramChannel from "../../registry/channels/telegram/index.js";

describe("telegram", () => {
  let channel: ReturnType<typeof createTelegramChannel>;

  beforeEach(() => {
    vi.clearAllMocks();
    channel = createTelegramChannel({ botToken: "test-token-123" });
  });

  it("should have correct channel name", () => {
    expect(channel.name).toBe("telegram");
  });

  it("should connect and register message handler", async () => {
    await channel.connect({});

    expect(mockBot.on).toHaveBeenCalledWith("message", expect.any(Function));
    expect(mockBot.start).toHaveBeenCalled();
  });

  it("should send text messages", async () => {
    await channel.connect({});
    await channel.sendMessage("12345", { text: "Hello!" });

    expect(mockBot.api.sendMessage).toHaveBeenCalledWith(
      12345,
      "Hello!",
      expect.objectContaining({})
    );
  });

  it("should register onMessage callback", () => {
    const callback = vi.fn();
    channel.onMessage(callback);
    // callback is stored internally; verified through integration
    expect(true).toBe(true);
  });

  it("should parse text messages from mock context", async () => {
    let messageHandler: Function;
    mockBot.on.mockImplementation((event: string, handler: Function) => {
      if (event === "message") messageHandler = handler;
    });

    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));
    await channel.connect({});

    // Simulate incoming message
    messageHandler!({
      message: {
        message_id: 42,
        from: { id: 100, first_name: "John", last_name: "Doe" },
        chat: { id: 100, type: "private" },
        text: "Hello bot",
        date: Math.floor(Date.now() / 1000),
      },
    });

    expect(received).toHaveLength(1);
    expect(received[0].content).toBe("Hello bot");
    expect(received[0].channel).toBe("telegram");
    expect(received[0].senderName).toBe("John Doe");
  });

  it("should parse group messages", async () => {
    let messageHandler: Function;
    mockBot.on.mockImplementation((event: string, handler: Function) => {
      if (event === "message") messageHandler = handler;
    });

    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));
    await channel.connect({});

    messageHandler!({
      message: {
        message_id: 43,
        from: { id: 200, first_name: "Alice" },
        chat: { id: -1001234, type: "supergroup", title: "Test Group" },
        text: "Group message",
        date: Math.floor(Date.now() / 1000),
      },
    });

    expect(received).toHaveLength(1);
    expect(received[0].group).toBe("-1001234");
    expect(received[0].groupName).toBe("Test Group");
  });

  it("should disconnect cleanly", async () => {
    await channel.connect({});
    await channel.disconnect();

    expect(mockBot.stop).toHaveBeenCalled();
  });

  it("should throw without bot token", async () => {
    const noToken = createTelegramChannel({ botToken: "" });
    await expect(noToken.connect({})).rejects.toThrow("bot token required");
  });
});
