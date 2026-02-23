import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock imapflow
const mockFetch = vi.fn();
const mockGetMailboxLock = vi.fn().mockResolvedValue({ release: vi.fn() });
const mockImapConnect = vi.fn().mockResolvedValue(undefined);
const mockImapLogout = vi.fn().mockResolvedValue(undefined);

vi.mock("imapflow", () => ({
  ImapFlow: vi.fn(() => ({
    connect: mockImapConnect,
    logout: mockImapLogout,
    getMailboxLock: mockGetMailboxLock,
    fetch: mockFetch,
  })),
}));

// Mock nodemailer
const mockSendMail = vi.fn().mockResolvedValue({ messageId: "test-id" });
const mockTransporterClose = vi.fn();

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: mockSendMail,
      close: mockTransporterClose,
    })),
  },
  createTransport: vi.fn(() => ({
    sendMail: mockSendMail,
    close: mockTransporterClose,
  })),
}));

import createEmailChannel from "../../registry/channels/email/index.js";

describe("email", () => {
  let channel: ReturnType<typeof createEmailChannel>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    channel = createEmailChannel({
      imapHost: "imap.test.com",
      imapPort: 993,
      smtpHost: "smtp.test.com",
      smtpPort: 587,
      user: "test@test.com",
      password: "password123",
      pollInterval: 60000,
    });

    // Default: fetch returns empty iterator
    mockFetch.mockReturnValue((async function* () {})());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should have correct channel name", () => {
    expect(channel.name).toBe("email");
  });

  it("should throw without user", async () => {
    const noUser = createEmailChannel({ user: "" });
    await expect(noUser.connect({})).rejects.toThrow("user required");
  });

  it("should connect IMAP and create SMTP transport", async () => {
    await channel.connect({});

    expect(mockImapConnect).toHaveBeenCalled();
  });

  it("should send text messages via SMTP", async () => {
    await channel.connect({});
    await channel.sendMessage("recipient@test.com", { text: "Hello via email!" });

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "test@test.com",
        to: "recipient@test.com",
        text: "Hello via email!",
      }),
    );
  });

  it("should send media as email attachment", async () => {
    await channel.connect({});
    await channel.sendMedia("recipient@test.com", {
      type: "document",
      data: "aGVsbG8=",
      mimeType: "application/pdf",
      filename: "doc.pdf",
      caption: "Here is the document",
    });

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "recipient@test.com",
        subject: "Here is the document",
        attachments: expect.arrayContaining([
          expect.objectContaining({
            filename: "doc.pdf",
            contentType: "application/pdf",
          }),
        ]),
      }),
    );
  });

  it("should send threaded replies with subject prefix", async () => {
    await channel.connect({});
    await channel.sendMessage("recipient@test.com", {
      text: "This is a reply",
      replyTo: "Original Subject",
    });

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Re: Original Subject",
      }),
    );
  });

  it("should disconnect all connections", async () => {
    await channel.connect({});
    await channel.disconnect();

    expect(mockImapLogout).toHaveBeenCalled();
    expect(mockTransporterClose).toHaveBeenCalled();
  });

  it("should throw when sending without connection", async () => {
    await expect(
      channel.sendMessage("test@test.com", { text: "fail" }),
    ).rejects.toThrow("not connected");
  });
});
