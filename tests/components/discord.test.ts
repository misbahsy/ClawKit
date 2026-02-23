import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock discord.js
const mockClient = {
  on: vi.fn(),
  login: vi.fn().mockResolvedValue(""),
  destroy: vi.fn(),
  user: { tag: "TestBot#1234" },
  channels: {
    fetch: vi.fn().mockResolvedValue({
      send: vi.fn().mockResolvedValue({}),
    }),
  },
};

vi.mock("discord.js", () => ({
  Client: vi.fn(() => mockClient),
  GatewayIntentBits: {
    Guilds: 1,
    GuildMessages: 2,
    MessageContent: 4,
    DirectMessages: 8,
  },
  AttachmentBuilder: vi.fn((data: any, opts: any) => ({ data, ...opts })),
}));

import createDiscordChannel from "../../registry/channels/discord/index.js";

describe("discord", () => {
  let channel: ReturnType<typeof createDiscordChannel>;

  beforeEach(() => {
    vi.clearAllMocks();
    channel = createDiscordChannel({ botToken: "test-discord-token" });
  });

  it("should have correct channel name", () => {
    expect(channel.name).toBe("discord");
  });

  it("should connect and login", async () => {
    await channel.connect({});

    expect(mockClient.login).toHaveBeenCalledWith("test-discord-token");
    expect(mockClient.on).toHaveBeenCalledWith("messageCreate", expect.any(Function));
  });

  it("should send text messages", async () => {
    const mockChannel = { send: vi.fn().mockResolvedValue({}) };
    mockClient.channels.fetch.mockResolvedValue(mockChannel);

    await channel.connect({});
    await channel.sendMessage("channel-123", { text: "Hello Discord!" });

    expect(mockClient.channels.fetch).toHaveBeenCalledWith("channel-123");
    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Hello Discord!" })
    );
  });

  it("should parse incoming messages", async () => {
    let messageHandler: Function;
    mockClient.on.mockImplementation((event: string, handler: Function) => {
      if (event === "messageCreate") messageHandler = handler;
    });

    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));
    await channel.connect({});

    // Simulate incoming Discord message
    messageHandler!({
      id: "msg-1",
      author: { id: "user-1", username: "testuser", displayName: "Test User", bot: false },
      content: "Hello from Discord",
      guild: { id: "guild-1" },
      channelId: "channel-1",
      channel: { name: "general" },
      createdAt: new Date(),
      attachments: new Map(),
      reference: null,
    });

    expect(received).toHaveLength(1);
    expect(received[0].content).toBe("Hello from Discord");
    expect(received[0].channel).toBe("discord");
    expect(received[0].senderName).toBe("Test User");
    expect(received[0].group).toBe("channel-1");
  });

  it("should ignore bot messages", async () => {
    let messageHandler: Function;
    mockClient.on.mockImplementation((event: string, handler: Function) => {
      if (event === "messageCreate") messageHandler = handler;
    });

    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));
    await channel.connect({});

    messageHandler!({
      id: "msg-2",
      author: { id: "bot-1", username: "otherbot", bot: true },
      content: "Bot message",
      guild: null,
      channelId: "ch-1",
      channel: {},
      createdAt: new Date(),
      attachments: new Map(),
    });

    expect(received).toHaveLength(0);
  });

  it("should disconnect cleanly", async () => {
    await channel.connect({});
    await channel.disconnect();

    expect(mockClient.destroy).toHaveBeenCalled();
  });

  it("should throw without bot token", async () => {
    const noToken = createDiscordChannel({ botToken: "" });
    await expect(noToken.connect({})).rejects.toThrow("bot token required");
  });
});
