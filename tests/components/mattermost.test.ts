import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @mattermost/client — factory must not reference outer variables (hoisting)
let wsMessageListener: Function | null = null;

vi.mock("@mattermost/client", () => {
  const mockGetMe = vi.fn().mockResolvedValue({ id: "bot-user-id", username: "clawkit-bot" });
  const mockCreatePost = vi.fn().mockResolvedValue({});
  const mockUploadFile = vi.fn().mockResolvedValue({ file_infos: [{ id: "file-1" }] });
  const mockSetUrl = vi.fn();
  const mockSetToken = vi.fn();

  return {
    Client4: {
      setUrl: mockSetUrl,
      setToken: mockSetToken,
      getMe: mockGetMe,
      createPost: mockCreatePost,
      uploadFile: mockUploadFile,
    },
    WebSocketClient: vi.fn(() => ({
      initialize: vi.fn(),
      addMessageListener: vi.fn((handler: Function) => {
        wsMessageListener = handler;
      }),
      close: vi.fn(),
    })),
  };
});

import createMattermostChannel from "../../registry/channels/mattermost/index.js";
import { Client4, WebSocketClient } from "@mattermost/client";

describe("mattermost", () => {
  let channel: ReturnType<typeof createMattermostChannel>;

  beforeEach(() => {
    vi.clearAllMocks();
    wsMessageListener = null;
    channel = createMattermostChannel({
      serverUrl: "https://mattermost.example.com",
      token: "test-token-xyz",
      teamId: "team-123",
    });
  });

  it("should have correct channel name", () => {
    expect(channel.name).toBe("mattermost");
  });

  it("should connect, authenticate, and open websocket", async () => {
    await channel.connect({});

    expect(Client4.setUrl).toHaveBeenCalledWith("https://mattermost.example.com");
    expect(Client4.setToken).toHaveBeenCalledWith("test-token-xyz");
    expect(Client4.getMe).toHaveBeenCalled();
    expect(WebSocketClient).toHaveBeenCalled();
  });

  it("should throw without server URL", async () => {
    const noUrl = createMattermostChannel({ serverUrl: "" });
    await expect(noUrl.connect({})).rejects.toThrow("server URL required");
  });

  it("should throw without token", async () => {
    const noToken = createMattermostChannel({
      serverUrl: "https://mattermost.example.com",
      token: "",
    });
    await expect(noToken.connect({})).rejects.toThrow("token required");
  });

  it("should parse incoming posted events", async () => {
    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));
    await channel.connect({});

    // Simulate websocket posted event
    wsMessageListener!({
      event: "posted",
      data: {
        post: JSON.stringify({
          id: "post-1",
          user_id: "user-abc",
          message: "Hello Mattermost!",
          channel_id: "channel-xyz",
          create_at: 1700000000000,
          root_id: "",
        }),
        sender_name: "alice",
        channel_display_name: "Town Square",
      },
    });

    expect(received).toHaveLength(1);
    expect(received[0].content).toBe("Hello Mattermost!");
    expect(received[0].channel).toBe("mattermost");
    expect(received[0].sender).toBe("user-abc");
    expect(received[0].senderName).toBe("alice");
    expect(received[0].group).toBe("channel-xyz");
    expect(received[0].groupName).toBe("Town Square");
  });

  it("should ignore own messages", async () => {
    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));
    await channel.connect({});

    wsMessageListener!({
      event: "posted",
      data: {
        post: JSON.stringify({
          id: "post-2",
          user_id: "bot-user-id",
          message: "My own message",
          channel_id: "channel-xyz",
          create_at: 1700000000000,
        }),
        sender_name: "clawkit-bot",
      },
    });

    expect(received).toHaveLength(0);
  });

  it("should ignore non-posted events", async () => {
    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));
    await channel.connect({});

    wsMessageListener!({
      event: "typing",
      data: { user_id: "user-abc" },
    });

    expect(received).toHaveLength(0);
  });

  it("should parse threaded replies", async () => {
    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));
    await channel.connect({});

    wsMessageListener!({
      event: "posted",
      data: {
        post: JSON.stringify({
          id: "post-3",
          user_id: "user-def",
          message: "Thread reply",
          channel_id: "channel-xyz",
          create_at: 1700000001000,
          root_id: "post-1",
        }),
        sender_name: "bob",
      },
    });

    expect(received).toHaveLength(1);
    expect(received[0].replyTo).toBe("post-1");
  });

  it("should send messages via createPost", async () => {
    await channel.connect({});
    await channel.sendMessage("channel-xyz", { text: "Hello from bot!" });

    expect(Client4.createPost).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_id: "channel-xyz",
        message: "Hello from bot!",
        root_id: "",
      }),
    );
  });

  it("should send threaded replies", async () => {
    await channel.connect({});
    await channel.sendMessage("channel-xyz", { text: "Reply", replyTo: "post-1" });

    expect(Client4.createPost).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_id: "channel-xyz",
        message: "Reply",
        root_id: "post-1",
      }),
    );
  });

  it("should disconnect cleanly", async () => {
    await channel.connect({});
    await channel.disconnect();

    // After disconnect, the wsClient is nulled
    // Re-connecting would create a new WebSocketClient
  });
});
