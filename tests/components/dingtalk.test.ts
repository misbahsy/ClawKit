import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import createDingTalkChannel from "../../registry/channels/dingtalk/index.js";

describe("dingtalk", () => {
  let channel: ReturnType<typeof createDingTalkChannel> & { handleEvent(event: any): void };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: fetch returns ok
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ errcode: 0, errmsg: "ok" }),
      text: async () => "",
    });

    channel = createDingTalkChannel({
      accessToken: "test_access_token",
      secret: "test_secret",
      agentId: "test_agent_id",
    }) as any;
  });

  it("should have correct channel name", () => {
    expect(channel.name).toBe("dingtalk");
  });

  it("should connect without throwing", async () => {
    await expect(channel.connect({})).resolves.toBeUndefined();
    await channel.disconnect();
  });

  it("should throw without accessToken and webhookUrl", async () => {
    const noToken = createDingTalkChannel({ accessToken: "", webhookUrl: "" });
    await expect(noToken.connect({})).rejects.toThrow("access token or webhook URL required");
  });

  it("should register onMessage callback and handle events", async () => {
    await channel.connect({});

    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));

    channel.handleEvent({
      msgId: "msg-001",
      msgtype: "text",
      text: { content: "Hello from DingTalk" },
      senderStaffId: "user-123",
      senderNick: "Alice",
      conversationType: "1",
      createAt: Date.now(),
    });

    expect(received).toHaveLength(1);
    expect(received[0].content).toBe("Hello from DingTalk");
    expect(received[0].channel).toBe("dingtalk");
    expect(received[0].sender).toBe("user-123");
    expect(received[0].senderName).toBe("Alice");

    await channel.disconnect();
  });

  it("should handle group messages", async () => {
    await channel.connect({});

    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));

    channel.handleEvent({
      msgId: "msg-002",
      msgtype: "text",
      text: { content: "Group message" },
      senderNick: "Bob",
      conversationType: "2",
      conversationId: "conv-group-001",
      conversationTitle: "Dev Team",
    });

    expect(received).toHaveLength(1);
    expect(received[0].group).toBe("conv-group-001");
    expect(received[0].groupName).toBe("Dev Team");

    await channel.disconnect();
  });

  it("should send message via webhook API", async () => {
    await channel.connect({});

    await channel.sendMessage("user-456", { text: "Hello from ClawKit!" });

    const sendCall = mockFetch.mock.calls.find(
      (call: any) => typeof call[0] === "string" && call[0].includes("oapi.dingtalk.com") && call[1]?.method === "POST"
    );

    expect(sendCall).toBeTruthy();
    expect(sendCall![0]).toContain("access_token=test_access_token");

    const body = JSON.parse(sendCall![1].body);
    expect(body.msgtype).toBe("text");
    expect(body.text.content).toBe("Hello from ClawKit!");

    await channel.disconnect();
  });

  it("should include HMAC signature when secret is set", async () => {
    await channel.connect({});

    await channel.sendMessage("user-789", { text: "Signed message" });

    const sendCall = mockFetch.mock.calls.find(
      (call: any) => typeof call[0] === "string" && call[0].includes("sign=") && call[1]?.method === "POST"
    );

    expect(sendCall).toBeTruthy();
    expect(sendCall![0]).toContain("timestamp=");
    expect(sendCall![0]).toContain("sign=");

    await channel.disconnect();
  });

  it("should throw when API returns error code", async () => {
    await channel.connect({});

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ errcode: 40035, errmsg: "invalid access_token" }),
    });

    await expect(
      channel.sendMessage("user-456", { text: "fail" })
    ).rejects.toThrow("DingTalk API error");

    await channel.disconnect();
  });

  it("should throw sendMessage when not connected", async () => {
    await expect(
      channel.sendMessage("user-456", { text: "fail" })
    ).rejects.toThrow("not connected");
  });

  it("should disconnect cleanly", async () => {
    await channel.connect({});
    await expect(channel.disconnect()).resolves.toBeUndefined();
  });
});
