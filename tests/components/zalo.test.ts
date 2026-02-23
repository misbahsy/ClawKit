import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import createZaloChannel from "../../registry/channels/zalo/index.js";

describe("zalo", () => {
  let channel: ReturnType<typeof createZaloChannel> & { handleEvent(event: any): void };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: token validation succeeds
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ error: 0, data: { oa_id: "12345" } }),
      text: async () => "",
    });

    channel = createZaloChannel({
      oaAccessToken: "test_oa_access_token",
      oaSecretKey: "test_oa_secret",
    }) as any;
  });

  it("should have correct channel name", () => {
    expect(channel.name).toBe("zalo");
  });

  it("should connect and validate OA token", async () => {
    await channel.connect({});

    const validationCall = mockFetch.mock.calls.find(
      (call: any) => typeof call[0] === "string" && call[0].includes("/getoa")
    );

    expect(validationCall).toBeTruthy();
    expect(validationCall![1].headers.access_token).toBe("test_oa_access_token");

    await channel.disconnect();
  });

  it("should throw without oaAccessToken", async () => {
    const noToken = createZaloChannel({ oaAccessToken: "" });
    await expect(noToken.connect({})).rejects.toThrow("access token required");
  });

  it("should throw when token validation fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
    });

    const badToken = createZaloChannel({ oaAccessToken: "bad_token" });
    await expect(badToken.connect({})).rejects.toThrow("token validation failed");
  });

  it("should register onMessage callback and handle text events", async () => {
    await channel.connect({});

    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));

    channel.handleEvent({
      event_name: "user_send_text",
      sender: { id: "zalo-user-001", name: "Nguyen" },
      message: {
        msg_id: "zmsg-001",
        text: "Xin chao from Zalo",
      },
      timestamp: Date.now(),
    });

    expect(received).toHaveLength(1);
    expect(received[0].content).toBe("Xin chao from Zalo");
    expect(received[0].channel).toBe("zalo");
    expect(received[0].sender).toBe("zalo-user-001");
    expect(received[0].senderName).toBe("Nguyen");

    await channel.disconnect();
  });

  it("should handle image events with attachments", async () => {
    await channel.connect({});

    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));

    channel.handleEvent({
      event_name: "user_send_image",
      sender: { id: "zalo-user-002" },
      message: {
        msg_id: "zmsg-002",
        text: "",
        attachments: [{
          type: "image",
          payload: { url: "https://zalo.me/image.jpg", type: "image/jpeg" },
        }],
      },
      timestamp: Date.now(),
    });

    expect(received).toHaveLength(1);
    expect(received[0].media).toHaveLength(1);
    expect(received[0].media[0].type).toBe("image");
    expect(received[0].media[0].url).toBe("https://zalo.me/image.jpg");

    await channel.disconnect();
  });

  it("should ignore non-message events", async () => {
    await channel.connect({});

    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));

    channel.handleEvent({
      event_name: "follow",
      sender: { id: "zalo-user-003" },
    });

    expect(received).toHaveLength(0);

    await channel.disconnect();
  });

  it("should send message via Zalo OA API", async () => {
    await channel.connect({});

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: 0 }),
    });

    await channel.sendMessage("zalo-user-001", { text: "Hello from ClawKit!" });

    const sendCall = mockFetch.mock.calls.find(
      (call: any) => typeof call[0] === "string" && call[0].includes("/message/cs") && call[1]?.method === "POST"
    );

    expect(sendCall).toBeTruthy();
    expect(sendCall![1].headers.access_token).toBe("test_oa_access_token");

    const body = JSON.parse(sendCall![1].body);
    expect(body.recipient.user_id).toBe("zalo-user-001");
    expect(body.message.text).toBe("Hello from ClawKit!");

    await channel.disconnect();
  });

  it("should throw when send fails with HTTP error", async () => {
    await channel.connect({});

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => "Bad Request",
    });

    await expect(
      channel.sendMessage("zalo-user-001", { text: "fail" })
    ).rejects.toThrow("Zalo send failed");

    await channel.disconnect();
  });

  it("should throw when send returns API error", async () => {
    await channel.connect({});

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: -201, message: "Invalid recipient" }),
    });

    await expect(
      channel.sendMessage("bad-user", { text: "fail" })
    ).rejects.toThrow("Zalo API error");

    await channel.disconnect();
  });

  it("should throw sendMessage when not connected", async () => {
    await expect(
      channel.sendMessage("zalo-user-001", { text: "fail" })
    ).rejects.toThrow("not connected");
  });

  it("should disconnect cleanly", async () => {
    await channel.connect({});
    await expect(channel.disconnect()).resolves.toBeUndefined();
  });
});
