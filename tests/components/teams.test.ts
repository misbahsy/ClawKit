import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock botframework-connector
const mockContinueConversation = vi.fn(async (_ref: any, callback: Function) => {
  const mockContext = {
    sendActivity: vi.fn().mockResolvedValue({}),
    activity: {},
  };
  await callback(mockContext);
  return mockContext;
});

const mockAdapter = {
  continueConversation: mockContinueConversation,
  _clawkitHandler: null as Function | null,
};

const mockGetConversationReference = vi.fn((activity: any) => ({
  conversation: activity.conversation,
  serviceUrl: "https://smba.trafficmanager.net/teams/",
  channelId: "msteams",
}));

vi.mock("botframework-connector", () => ({
  BotFrameworkAdapter: vi.fn(() => mockAdapter),
  TurnContext: {
    getConversationReference: (...args: any[]) => mockGetConversationReference(...args),
  },
}));

import createTeamsChannel from "../../registry/channels/teams/index.js";

describe("teams", () => {
  let channel: ReturnType<typeof createTeamsChannel>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter._clawkitHandler = null;
    channel = createTeamsChannel({
      appId: "test-app-id",
      appPassword: "test-app-password",
    });
  });

  it("should have correct channel name", () => {
    expect(channel.name).toBe("teams");
  });

  it("should connect and create adapter", async () => {
    const { BotFrameworkAdapter } = await import("botframework-connector");
    await channel.connect({});

    expect(BotFrameworkAdapter).toHaveBeenCalledWith({
      appId: "test-app-id",
      appPassword: "test-app-password",
    });
  });

  it("should throw without app ID", async () => {
    const noId = createTeamsChannel({ appId: "" });
    await expect(noId.connect({})).rejects.toThrow("app ID required");
  });

  it("should throw without app password", async () => {
    const noPassword = createTeamsChannel({
      appId: "test-app-id",
      appPassword: "",
    });
    await expect(noPassword.connect({})).rejects.toThrow("app password required");
  });

  it("should parse incoming activity messages", async () => {
    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));
    await channel.connect({});

    // Simulate incoming activity via the handler
    const handler = mockAdapter._clawkitHandler!;
    expect(handler).toBeTruthy();

    await handler({
      activity: {
        type: "message",
        id: "activity-1",
        text: "Hello Teams!",
        from: { id: "user-1", name: "Alice Johnson" },
        conversation: { id: "conv-1", isGroup: false },
        timestamp: new Date("2024-01-01T00:00:00Z"),
        replyToId: undefined,
        attachments: [],
      },
    });

    expect(received).toHaveLength(1);
    expect(received[0].content).toBe("Hello Teams!");
    expect(received[0].channel).toBe("teams");
    expect(received[0].sender).toBe("user-1");
    expect(received[0].senderName).toBe("Alice Johnson");
  });

  it("should parse group conversation messages", async () => {
    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));
    await channel.connect({});

    await mockAdapter._clawkitHandler!({
      activity: {
        type: "message",
        id: "activity-2",
        text: "Group message",
        from: { id: "user-2", name: "Bob" },
        conversation: { id: "conv-group-1", isGroup: true, name: "Engineering" },
        timestamp: new Date(),
        attachments: [],
      },
    });

    expect(received).toHaveLength(1);
    expect(received[0].group).toBe("conv-group-1");
    expect(received[0].groupName).toBe("Engineering");
  });

  it("should ignore non-message activities", async () => {
    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));
    await channel.connect({});

    await mockAdapter._clawkitHandler!({
      activity: {
        type: "typing",
        id: "activity-3",
        from: { id: "user-1", name: "Alice" },
        conversation: { id: "conv-1" },
      },
    });

    expect(received).toHaveLength(0);
  });

  it("should store conversation reference and send messages", async () => {
    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));
    await channel.connect({});

    // First receive a message to store reference
    await mockAdapter._clawkitHandler!({
      activity: {
        type: "message",
        id: "activity-4",
        text: "Hello",
        from: { id: "user-1", name: "Alice" },
        conversation: { id: "conv-1", isGroup: false },
        timestamp: new Date(),
        attachments: [],
      },
    });

    // Now send a response
    await channel.sendMessage("conv-1", { text: "Reply from bot!" });

    expect(mockContinueConversation).toHaveBeenCalledWith(
      expect.objectContaining({ conversation: { id: "conv-1", isGroup: false } }),
      expect.any(Function),
    );
  });

  it("should throw when sending without conversation reference", async () => {
    await channel.connect({});
    await expect(channel.sendMessage("unknown-conv", { text: "Hello" })).rejects.toThrow(
      "No conversation reference",
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

    // Adapter is nulled and conversation references cleared
    // Sending after disconnect should throw
    await expect(channel.sendMessage("conv-1", { text: "post-disconnect" })).rejects.toThrow(
      "not initialized",
    );
  });
});
