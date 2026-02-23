import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import createSmsChannel from "../../registry/channels/sms/index.js";

describe("sms", () => {
  let channel: ReturnType<typeof createSmsChannel>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Default: fetch returns ok
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [] }),
      text: async () => "",
    });

    channel = createSmsChannel({
      accountSid: "AC_test_sid",
      authToken: "test_auth_token",
      fromNumber: "+15551234567",
      pollInterval: 60000,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should have correct channel name", () => {
    expect(channel.name).toBe("sms");
  });

  it("should connect without throwing", async () => {
    await expect(channel.connect({})).resolves.toBeUndefined();
    await channel.disconnect();
  });

  it("should throw without accountSid", async () => {
    const noSid = createSmsChannel({ accountSid: "", authToken: "tok", fromNumber: "+1" });
    await expect(noSid.connect({})).rejects.toThrow("account SID required");
  });

  it("should throw without authToken", async () => {
    const noToken = createSmsChannel({ accountSid: "AC123", authToken: "", fromNumber: "+1" });
    await expect(noToken.connect({})).rejects.toThrow("auth token required");
  });

  it("should throw without fromNumber", async () => {
    const noFrom = createSmsChannel({ accountSid: "AC123", authToken: "tok", fromNumber: "" });
    await expect(noFrom.connect({})).rejects.toThrow("from number required");
  });

  it("should register onMessage callback", async () => {
    const callback = vi.fn();
    channel.onMessage(callback);
    await channel.connect({});
    await channel.disconnect();
  });

  it("should poll Twilio and deliver messages", async () => {
    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));
    await channel.connect({});

    // Simulate poll returning messages
    const futureDate = new Date(Date.now() + 60000).toISOString();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        messages: [{
          sid: "SM_test_123",
          from: "+15559876543",
          body: "Hello via SMS",
          date_sent: futureDate,
          date_created: futureDate,
        }],
      }),
    });

    await vi.advanceTimersByTimeAsync(60000);

    expect(received).toHaveLength(1);
    expect(received[0].content).toBe("Hello via SMS");
    expect(received[0].channel).toBe("sms");
    expect(received[0].sender).toBe("+15559876543");
    expect(received[0].id).toBe("SM_test_123");

    await channel.disconnect();
  });

  it("should send SMS via Twilio API", async () => {
    await channel.connect({});

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sid: "SM_sent_123" }),
    });

    await channel.sendMessage("+15559999999", { text: "Hello from ClawKit!" });

    const sendCall = mockFetch.mock.calls.find(
      (call: any) => typeof call[0] === "string" && call[0].includes("Messages.json") && call[1]?.method === "POST"
    );

    expect(sendCall).toBeTruthy();
    expect(sendCall![0]).toContain("AC_test_sid");
    expect(sendCall![1].headers.Authorization).toContain("Basic");
    expect(sendCall![1].body).toContain("To=%2B15559999999");
    expect(sendCall![1].body).toContain("From=%2B15551234567");
    expect(sendCall![1].body).toContain("Body=Hello+from+ClawKit");

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
      channel.sendMessage("+15559999999", { text: "fail" })
    ).rejects.toThrow("Twilio send failed");

    await channel.disconnect();
  });

  it("should throw sendMessage when not connected", async () => {
    await expect(
      channel.sendMessage("+15559999999", { text: "fail" })
    ).rejects.toThrow("not connected");
  });

  it("should disconnect cleanly", async () => {
    await channel.connect({});
    await expect(channel.disconnect()).resolves.toBeUndefined();
  });
});
