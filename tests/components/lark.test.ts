import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import createLarkChannel from "../../registry/channels/lark/index.js";

describe("lark", () => {
  let channel: ReturnType<typeof createLarkChannel> & { handleEvent(event: any): void };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: token refresh succeeds
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, tenant_access_token: "t-test-token", expire: 7200 }),
      text: async () => "",
    });

    channel = createLarkChannel({
      appId: "cli_test_app_id",
      appSecret: "test_app_secret",
      verificationToken: "test_verification_token",
    }) as any;
  });

  it("should have correct channel name", () => {
    expect(channel.name).toBe("lark");
  });

  it("should connect and get tenant access token", async () => {
    await channel.connect({});

    const tokenCall = mockFetch.mock.calls.find(
      (call: any) => typeof call[0] === "string" && call[0].includes("tenant_access_token")
    );

    expect(tokenCall).toBeTruthy();
    const body = JSON.parse(tokenCall![1].body);
    expect(body.app_id).toBe("cli_test_app_id");
    expect(body.app_secret).toBe("test_app_secret");

    await channel.disconnect();
  });

  it("should throw without appId", async () => {
    const noId = createLarkChannel({ appId: "", appSecret: "secret" });
    await expect(noId.connect({})).rejects.toThrow("app ID required");
  });

  it("should throw without appSecret", async () => {
    const noSecret = createLarkChannel({ appId: "id", appSecret: "" });
    await expect(noSecret.connect({})).rejects.toThrow("app secret required");
  });

  it("should register onMessage callback and handle events", async () => {
    await channel.connect({});

    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));

    channel.handleEvent({
      header: { event_type: "im.message.receive_v1" },
      event: {
        sender: { sender_id: { open_id: "ou_user123", name: "Alice" } },
        message: {
          message_id: "msg-001",
          chat_type: "p2p",
          content: JSON.stringify({ text: "Hello from Lark" }),
          create_time: String(Date.now()),
        },
      },
    });

    expect(received).toHaveLength(1);
    expect(received[0].content).toBe("Hello from Lark");
    expect(received[0].channel).toBe("lark");
    expect(received[0].sender).toBe("ou_user123");

    await channel.disconnect();
  });

  it("should handle group messages", async () => {
    await channel.connect({});

    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));

    channel.handleEvent({
      header: { event_type: "im.message.receive_v1" },
      event: {
        sender: { sender_id: { open_id: "ou_user456" } },
        message: {
          message_id: "msg-002",
          chat_type: "group",
          chat_id: "oc_group789",
          content: JSON.stringify({ text: "Hello group" }),
          create_time: String(Date.now()),
        },
      },
    });

    expect(received).toHaveLength(1);
    expect(received[0].group).toBe("oc_group789");

    await channel.disconnect();
  });

  it("should ignore non-message events", async () => {
    await channel.connect({});

    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));

    channel.handleEvent({
      header: { event_type: "some.other.event" },
      event: {},
    });

    expect(received).toHaveLength(0);

    await channel.disconnect();
  });

  it("should send message via Lark API", async () => {
    await channel.connect({});

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ code: 0 }),
    });

    await channel.sendMessage("oc_chat123", { text: "Hello from ClawKit!" });

    const sendCall = mockFetch.mock.calls.find(
      (call: any) => typeof call[0] === "string" && call[0].includes("/im/v1/messages") && call[1]?.method === "POST"
    );

    expect(sendCall).toBeTruthy();
    expect(sendCall![0]).toContain("receive_id_type=chat_id");
    expect(sendCall![1].headers.Authorization).toBe("Bearer t-test-token");

    const body = JSON.parse(sendCall![1].body);
    expect(body.receive_id).toBe("oc_chat123");
    expect(body.msg_type).toBe("text");
    expect(JSON.parse(body.content).text).toBe("Hello from ClawKit!");

    await channel.disconnect();
  });

  it("should throw when send fails", async () => {
    await channel.connect({});

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => "Bad Request",
    });

    await expect(
      channel.sendMessage("oc_chat123", { text: "fail" })
    ).rejects.toThrow("Lark send failed");

    await channel.disconnect();
  });

  it("should throw sendMessage when not connected", async () => {
    await expect(
      channel.sendMessage("oc_chat123", { text: "fail" })
    ).rejects.toThrow("not connected");
  });

  it("should disconnect cleanly", async () => {
    await channel.connect({});
    await expect(channel.disconnect()).resolves.toBeUndefined();
  });
});
