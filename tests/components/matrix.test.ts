import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock matrix-js-sdk
const mockClient = {
  on: vi.fn(),
  startClient: vi.fn().mockResolvedValue(undefined),
  stopClient: vi.fn(),
  sendTextMessage: vi.fn().mockResolvedValue({}),
  sendMessage: vi.fn().mockResolvedValue({}),
  uploadContent: vi.fn().mockResolvedValue({ content_uri: "mxc://example.com/abc123" }),
};

vi.mock("matrix-js-sdk", () => ({
  createClient: vi.fn(() => mockClient),
}));

import createMatrixChannel from "../../registry/channels/matrix/index.js";

describe("matrix", () => {
  let channel: ReturnType<typeof createMatrixChannel>;

  beforeEach(() => {
    vi.clearAllMocks();
    channel = createMatrixChannel({
      homeserverUrl: "https://matrix.example.com",
      accessToken: "test-token-abc",
      userId: "@bot:example.com",
    });
  });

  it("should have correct channel name", () => {
    expect(channel.name).toBe("matrix");
  });

  it("should connect and start client sync", async () => {
    const { createClient } = await import("matrix-js-sdk");
    await channel.connect({});

    expect(createClient).toHaveBeenCalledWith({
      baseUrl: "https://matrix.example.com",
      accessToken: "test-token-abc",
      userId: "@bot:example.com",
    });
    expect(mockClient.on).toHaveBeenCalledWith("Room.timeline", expect.any(Function));
    expect(mockClient.startClient).toHaveBeenCalledWith({ initialSyncLimit: 0 });
  });

  it("should throw without homeserver URL", async () => {
    const noUrl = createMatrixChannel({ homeserverUrl: "" });
    await expect(noUrl.connect({})).rejects.toThrow("homeserver URL required");
  });

  it("should throw without access token", async () => {
    const noToken = createMatrixChannel({
      homeserverUrl: "https://matrix.example.com",
      accessToken: "",
    });
    await expect(noToken.connect({})).rejects.toThrow("access token required");
  });

  it("should parse incoming room messages", async () => {
    let timelineHandler: Function;
    mockClient.on.mockImplementation((event: string, handler: Function) => {
      if (event === "Room.timeline") timelineHandler = handler;
    });

    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));
    await channel.connect({});

    // Simulate incoming Matrix event
    const mockEvent = {
      getSender: () => "@alice:example.com",
      getContent: () => ({ msgtype: "m.text", body: "Hello Matrix!" }),
      getId: () => "$event-123",
      getType: () => "m.room.message",
      getTs: () => 1700000000000,
      getRoomId: () => "!room123:example.com",
    };

    const mockRoom = {
      roomId: "!room123:example.com",
      name: "General",
      getMember: () => ({ name: "Alice" }),
    };

    timelineHandler!(mockEvent, mockRoom);

    expect(received).toHaveLength(1);
    expect(received[0].content).toBe("Hello Matrix!");
    expect(received[0].channel).toBe("matrix");
    expect(received[0].sender).toBe("@alice:example.com");
    expect(received[0].senderName).toBe("Alice");
    expect(received[0].group).toBe("!room123:example.com");
    expect(received[0].groupName).toBe("General");
  });

  it("should ignore own messages", async () => {
    let timelineHandler: Function;
    mockClient.on.mockImplementation((event: string, handler: Function) => {
      if (event === "Room.timeline") timelineHandler = handler;
    });

    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));
    await channel.connect({});

    timelineHandler!({
      getSender: () => "@bot:example.com",
      getContent: () => ({ msgtype: "m.text", body: "Own message" }),
      getId: () => "$event-456",
      getType: () => "m.room.message",
      getTs: () => 1700000000000,
      getRoomId: () => "!room123:example.com",
    }, null);

    expect(received).toHaveLength(0);
  });

  it("should ignore non-text message types", async () => {
    let timelineHandler: Function;
    mockClient.on.mockImplementation((event: string, handler: Function) => {
      if (event === "Room.timeline") timelineHandler = handler;
    });

    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));
    await channel.connect({});

    timelineHandler!({
      getSender: () => "@alice:example.com",
      getContent: () => ({ msgtype: "m.image", body: "image.png" }),
      getId: () => "$event-789",
      getType: () => "m.room.message",
      getTs: () => 1700000000000,
      getRoomId: () => "!room123:example.com",
    }, null);

    expect(received).toHaveLength(0);
  });

  it("should send text messages", async () => {
    await channel.connect({});
    await channel.sendMessage("!room123:example.com", { text: "Hello from bot!" });

    expect(mockClient.sendTextMessage).toHaveBeenCalledWith(
      "!room123:example.com",
      "Hello from bot!",
    );
  });

  it("should register onMessage callback", () => {
    const callback = vi.fn();
    channel.onMessage(callback);
    expect(true).toBe(true);
  });

  it("should disconnect cleanly", async () => {
    await channel.connect({});
    await channel.disconnect();

    expect(mockClient.stopClient).toHaveBeenCalled();
  });
});
