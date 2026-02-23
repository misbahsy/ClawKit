import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import createQQChannel from "../../registry/channels/qq/index.js";

describe("qq", () => {
  let channel: ReturnType<typeof createQQChannel>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Default: go-cqhttp login info succeeds
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { nickname: "TestBot", user_id: 123456 } }),
      text: async () => "",
    });

    channel = createQQChannel({
      httpUrl: "http://localhost:5700",
      accessToken: "test_token",
      pollInterval: 60000,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should have correct channel name", () => {
    expect(channel.name).toBe("qq");
  });

  it("should connect and validate go-cqhttp", async () => {
    await channel.connect({});

    const loginCall = mockFetch.mock.calls.find(
      (call: any) => typeof call[0] === "string" && call[0].includes("/get_login_info")
    );

    expect(loginCall).toBeTruthy();
    expect(loginCall![1].headers.Authorization).toBe("Bearer test_token");

    await channel.disconnect();
  });

  it("should throw when go-cqhttp is not reachable", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const unreachable = createQQChannel({ httpUrl: "http://localhost:9999" });
    await expect(unreachable.connect({})).rejects.toThrow("Failed to connect to go-cqhttp");
  });

  it("should throw when go-cqhttp returns error status", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });

    const forbidden = createQQChannel({ httpUrl: "http://localhost:5700" });
    await expect(forbidden.connect({})).rejects.toThrow("go-cqhttp not reachable");
  });

  it("should register onMessage callback", async () => {
    const callback = vi.fn();
    channel.onMessage(callback);
    await channel.connect({});
    await channel.disconnect();
  });

  it("should poll and deliver messages", async () => {
    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));
    await channel.connect({});

    // Simulate poll returning messages
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          messages: [{
            message_id: 1001,
            message_type: "private",
            user_id: 987654,
            sender: { nickname: "Alice", card: "", user_id: 987654 },
            raw_message: "Hello from QQ",
            time: Math.floor(Date.now() / 1000) + 60,
          }],
        },
      }),
    });

    await vi.advanceTimersByTimeAsync(60000);

    expect(received).toHaveLength(1);
    expect(received[0].content).toBe("Hello from QQ");
    expect(received[0].channel).toBe("qq");
    expect(received[0].sender).toBe("987654");
    expect(received[0].senderName).toBe("Alice");
    expect(received[0].group).toBeUndefined();

    await channel.disconnect();
  });

  it("should handle group messages in polling", async () => {
    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));
    await channel.connect({});

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          messages: [{
            message_id: 1002,
            message_type: "group",
            user_id: 111222,
            group_id: 333444,
            group_name: "Dev Group",
            sender: { nickname: "Bob" },
            raw_message: "Group hello",
            time: Math.floor(Date.now() / 1000) + 60,
          }],
        },
      }),
    });

    await vi.advanceTimersByTimeAsync(60000);

    expect(received).toHaveLength(1);
    expect(received[0].group).toBe("333444");
    expect(received[0].groupName).toBe("Dev Group");

    await channel.disconnect();
  });

  it("should send private message via /send_msg", async () => {
    await channel.connect({});

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { message_id: 2001 } }),
    });

    await channel.sendMessage("555666", { text: "Hello QQ user!" });

    const sendCall = mockFetch.mock.calls.find(
      (call: any) => typeof call[0] === "string" && call[0].includes("/send_msg") && call[1]?.method === "POST"
    );

    expect(sendCall).toBeTruthy();
    const body = JSON.parse(sendCall![1].body);
    expect(body.user_id).toBe(555666);
    expect(body.message_type).toBe("private");
    expect(body.message).toBe("Hello QQ user!");

    await channel.disconnect();
  });

  it("should send group message with group: prefix", async () => {
    await channel.connect({});

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { message_id: 2002 } }),
    });

    await channel.sendMessage("group:333444", { text: "Hello QQ group!" });

    const sendCall = mockFetch.mock.calls.find(
      (call: any) => typeof call[0] === "string" && call[0].includes("/send_msg") && call[1]?.method === "POST"
    );

    expect(sendCall).toBeTruthy();
    const body = JSON.parse(sendCall![1].body);
    expect(body.group_id).toBe(333444);
    expect(body.message_type).toBe("group");

    await channel.disconnect();
  });

  it("should throw sendMessage when not connected", async () => {
    await expect(
      channel.sendMessage("555666", { text: "fail" })
    ).rejects.toThrow("not connected");
  });

  it("should disconnect cleanly", async () => {
    await channel.connect({});
    await expect(channel.disconnect()).resolves.toBeUndefined();
  });
});
