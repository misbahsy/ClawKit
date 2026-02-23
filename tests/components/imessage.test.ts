import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock child_process.execFile for AppleScript
const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: any[]) => mockExecFile(...args),
}));

// Mock global fetch for BlueBubbles mode
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import createIMessageChannel from "../../registry/channels/imessage/index.js";

describe("imessage", () => {
  let channel: ReturnType<typeof createIMessageChannel>;
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Default: AppleScript returns empty
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Function) => {
      cb(null, "", "");
    });

    // Default: fetch returns ok
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    // Pretend we are on macOS for tests
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });

  it("should have correct channel name", () => {
    channel = createIMessageChannel({});
    expect(channel.name).toBe("imessage");
  });

  it("should connect without throwing on macOS", async () => {
    channel = createIMessageChannel({ pollInterval: 60000 });
    await expect(channel.connect({})).resolves.toBeUndefined();
    await channel.disconnect();
  });

  it("should throw on non-macOS without BlueBubbles", async () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    channel = createIMessageChannel({});
    await expect(channel.connect({})).rejects.toThrow("macOS");
  });

  it("should connect via BlueBubbles on any platform", async () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    channel = createIMessageChannel({
      useBlueBubbles: true,
      blueBubblesUrl: "http://localhost:1234",
      blueBubblesPassword: "test-pass",
      pollInterval: 60000,
    });
    await expect(channel.connect({})).resolves.toBeUndefined();
    await channel.disconnect();
  });

  it("should register onMessage callback", async () => {
    channel = createIMessageChannel({ pollInterval: 60000 });
    const callback = vi.fn();
    channel.onMessage(callback);
    await channel.connect({});
    await channel.disconnect();
  });

  it("should poll BlueBubbles and deliver messages", async () => {
    channel = createIMessageChannel({
      useBlueBubbles: true,
      blueBubblesUrl: "http://bb.local",
      blueBubblesPassword: "pass",
      pollInterval: 5000,
    });

    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));
    await channel.connect({});

    // Now simulate a message appearing on next poll
    const futureTime = Date.now() + 60000;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{
          guid: "msg-001",
          text: "Hello from iMessage",
          dateCreated: futureTime,
          handle: { address: "+15551234567", firstName: "Alice" },
          chats: [{ guid: "chat-001", displayName: "Chat" }],
        }],
      }),
    });

    await vi.advanceTimersByTimeAsync(5000);

    expect(received).toHaveLength(1);
    expect(received[0].content).toBe("Hello from iMessage");
    expect(received[0].channel).toBe("imessage");
    expect(received[0].sender).toBe("+15551234567");
    expect(received[0].senderName).toBe("Alice");

    await channel.disconnect();
  });

  it("should send message via BlueBubbles API", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    channel = createIMessageChannel({
      useBlueBubbles: true,
      blueBubblesUrl: "http://bb.local",
      blueBubblesPassword: "pass",
      pollInterval: 60000,
    });

    await channel.connect({});

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await channel.sendMessage("chat-001", { text: "Hello back!" });

    // Find the POST call for sending
    const sendCall = mockFetch.mock.calls.find(
      (call: any) => typeof call[0] === "string" && call[0].includes("/message/text") && call[1]?.method === "POST"
    );
    expect(sendCall).toBeTruthy();

    const body = JSON.parse(sendCall![1].body);
    expect(body.chatGuid).toBe("chat-001");
    expect(body.message).toBe("Hello back!");

    await channel.disconnect();
  });

  it("should send message via AppleScript", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Function) => {
      cb(null, "", "");
    });

    channel = createIMessageChannel({ pollInterval: 60000 });
    await channel.connect({});

    await channel.sendMessage("+15559876543", { text: "Hello via AppleScript" });

    expect(mockExecFile).toHaveBeenCalled();
    const scriptArg = mockExecFile.mock.calls.find(
      (call: any) => call[1]?.[1]?.includes("send")
    );
    expect(scriptArg).toBeTruthy();

    await channel.disconnect();
  });

  it("should throw sendMessage when not connected", async () => {
    channel = createIMessageChannel({});
    await expect(channel.sendMessage("someone", { text: "fail" })).rejects.toThrow("not connected");
  });

  it("should disconnect cleanly", async () => {
    channel = createIMessageChannel({ pollInterval: 60000 });
    await channel.connect({});
    await expect(channel.disconnect()).resolves.toBeUndefined();
  });
});
