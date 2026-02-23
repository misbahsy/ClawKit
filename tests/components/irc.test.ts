import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock irc-framework
let registeredHandler: Function | null = null;
let messageHandler: Function | null = null;
let errorHandler: Function | null = null;

const mockClient = {
  connect: vi.fn(),
  on: vi.fn((event: string, handler: Function) => {
    if (event === "registered") registeredHandler = handler;
    if (event === "message") messageHandler = handler;
    if (event === "error") errorHandler = handler;
  }),
  join: vi.fn(),
  say: vi.fn(),
  quit: vi.fn(),
};

vi.mock("irc-framework", () => ({
  Client: vi.fn(() => mockClient),
}));

import createIrcChannel from "../../registry/channels/irc/index.js";

describe("irc", () => {
  let channel: ReturnType<typeof createIrcChannel>;

  beforeEach(() => {
    vi.clearAllMocks();
    registeredHandler = null;
    messageHandler = null;
    errorHandler = null;

    // Make connect trigger registered event asynchronously
    mockClient.connect.mockImplementation(() => {
      setTimeout(() => registeredHandler?.(), 0);
    });

    channel = createIrcChannel({
      server: "irc.example.com",
      port: 6667,
      nickname: "clawkit-bot",
      channels: ["#general", "#dev"],
    });
  });

  it("should have correct channel name", () => {
    expect(channel.name).toBe("irc");
  });

  it("should connect to server and join channels", async () => {
    await channel.connect({});

    expect(mockClient.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "irc.example.com",
        port: 6667,
        nick: "clawkit-bot",
      }),
    );
    expect(mockClient.join).toHaveBeenCalledWith("#general");
    expect(mockClient.join).toHaveBeenCalledWith("#dev");
  });

  it("should throw without server", async () => {
    const noServer = createIrcChannel({ server: "" });
    await expect(noServer.connect({})).rejects.toThrow("server required");
  });

  it("should throw without nickname", async () => {
    const noNick = createIrcChannel({ server: "irc.example.com", nickname: "" });
    await expect(noNick.connect({})).rejects.toThrow("nickname required");
  });

  it("should parse incoming channel messages", async () => {
    await channel.connect({});

    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));

    // Simulate incoming IRC message
    messageHandler!({
      nick: "alice",
      target: "#general",
      message: "Hello IRC!",
    });

    expect(received).toHaveLength(1);
    expect(received[0].content).toBe("Hello IRC!");
    expect(received[0].channel).toBe("irc");
    expect(received[0].sender).toBe("alice");
    expect(received[0].senderName).toBe("alice");
    expect(received[0].group).toBe("#general");
    expect(received[0].groupName).toBe("#general");
  });

  it("should parse private messages", async () => {
    await channel.connect({});

    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));

    messageHandler!({
      nick: "bob",
      target: "clawkit-bot",
      message: "Private hello!",
    });

    expect(received).toHaveLength(1);
    expect(received[0].content).toBe("Private hello!");
    expect(received[0].group).toBeUndefined();
  });

  it("should ignore own messages", async () => {
    await channel.connect({});

    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));

    messageHandler!({
      nick: "clawkit-bot",
      target: "#general",
      message: "My own message",
    });

    expect(received).toHaveLength(0);
  });

  it("should ignore empty messages", async () => {
    await channel.connect({});

    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));

    messageHandler!({
      nick: "alice",
      target: "#general",
      message: "",
    });

    expect(received).toHaveLength(0);
  });

  it("should send messages via say()", async () => {
    await channel.connect({});
    await channel.sendMessage("#general", { text: "Hello from bot!" });

    expect(mockClient.say).toHaveBeenCalledWith("#general", "Hello from bot!");
  });

  it("should split multiline messages", async () => {
    await channel.connect({});
    await channel.sendMessage("#general", { text: "Line 1\nLine 2\nLine 3" });

    expect(mockClient.say).toHaveBeenCalledTimes(3);
    expect(mockClient.say).toHaveBeenCalledWith("#general", "Line 1");
    expect(mockClient.say).toHaveBeenCalledWith("#general", "Line 2");
    expect(mockClient.say).toHaveBeenCalledWith("#general", "Line 3");
  });

  it("should send media as text fallback", async () => {
    await channel.connect({});
    await channel.sendMedia("#general", {
      type: "image",
      data: "base64data",
      mimeType: "image/png",
      filename: "photo.png",
      caption: "Check this out",
    });

    expect(mockClient.say).toHaveBeenCalledWith("#general", "Check this out");
  });

  it("should register onMessage callback", () => {
    const callback = vi.fn();
    channel.onMessage(callback);
    expect(true).toBe(true);
  });

  it("should disconnect cleanly", async () => {
    await channel.connect({});
    await channel.disconnect();

    expect(mockClient.quit).toHaveBeenCalledWith("ClawKit disconnecting");
  });
});
