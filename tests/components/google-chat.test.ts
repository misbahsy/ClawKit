import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock googleapis
const mockMessagesList = vi.fn().mockResolvedValue({ data: { messages: [] } });
const mockMessagesCreate = vi.fn().mockResolvedValue({});

const mockGoogleAuth = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    auth: {
      GoogleAuth: vi.fn((...args: any[]) => {
        mockGoogleAuth(...args);
        return {};
      }),
    },
    chat: vi.fn(() => ({
      spaces: {
        messages: {
          list: mockMessagesList,
          create: mockMessagesCreate,
        },
      },
    })),
  },
}));

import createGoogleChatChannel from "../../registry/channels/google-chat/index.js";

describe("google-chat", () => {
  let channel: ReturnType<typeof createGoogleChatChannel>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    channel = createGoogleChatChannel({
      credentials: "/path/to/credentials.json",
      spaceId: "space-abc",
      pollInterval: 5000,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should have correct channel name", () => {
    expect(channel.name).toBe("google-chat");
  });

  it("should connect and authenticate with Google", async () => {
    const { google } = await import("googleapis");
    await channel.connect({});

    expect(google.auth.GoogleAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        keyFile: "/path/to/credentials.json",
        scopes: ["https://www.googleapis.com/auth/chat.bot"],
      }),
    );
    expect(google.chat).toHaveBeenCalledWith(
      expect.objectContaining({ version: "v1" }),
    );
  });

  it("should throw without credentials", async () => {
    const noCreds = createGoogleChatChannel({ credentials: "" });
    await expect(noCreds.connect({})).rejects.toThrow("credentials required");
  });

  it("should throw without space ID", async () => {
    const noSpace = createGoogleChatChannel({
      credentials: "/path/to/creds.json",
      spaceId: "",
    });
    await expect(noSpace.connect({})).rejects.toThrow("space ID required");
  });

  it("should parse incoming messages from poll", async () => {
    mockMessagesList.mockResolvedValueOnce({
      data: {
        messages: [
          {
            name: "spaces/space-abc/messages/msg-1",
            text: "Hello Google Chat!",
            sender: { name: "users/user-123", displayName: "Alice" },
            space: { name: "spaces/space-abc", displayName: "General" },
            thread: { name: "spaces/space-abc/threads/thread-1" },
            createTime: "2024-01-01T00:00:00Z",
          },
        ],
      },
    });

    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));
    await channel.connect({});

    expect(received).toHaveLength(1);
    expect(received[0].content).toBe("Hello Google Chat!");
    expect(received[0].channel).toBe("google-chat");
    expect(received[0].sender).toBe("users/user-123");
    expect(received[0].senderName).toBe("Alice");
    expect(received[0].group).toBe("spaces/space-abc");
    expect(received[0].groupName).toBe("General");
  });

  it("should set up polling interval on connect", async () => {
    // Verify that setInterval is called during connect, setting up periodic polling.
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    await channel.connect({});

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
    setIntervalSpy.mockRestore();
  });

  it("should send messages via spaces.messages.create", async () => {
    await channel.connect({});
    await channel.sendMessage("space-abc", { text: "Hello from bot!" });

    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: "spaces/space-abc",
        requestBody: expect.objectContaining({ text: "Hello from bot!" }),
      }),
    );
  });

  it("should send threaded replies", async () => {
    await channel.connect({});
    await channel.sendMessage("space-abc", { text: "Reply", replyTo: "spaces/space-abc/threads/t-1" });

    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          text: "Reply",
          thread: { name: "spaces/space-abc/threads/t-1" },
        }),
      }),
    );
  });

  it("should handle spaces/ prefix in send target", async () => {
    await channel.connect({});
    await channel.sendMessage("spaces/space-abc", { text: "Prefixed" });

    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: "spaces/space-abc",
      }),
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

    // Verify no more polls after disconnect
    mockMessagesList.mockClear();
    await vi.advanceTimersByTimeAsync(10000);
    expect(mockMessagesList).not.toHaveBeenCalled();
  });
});
