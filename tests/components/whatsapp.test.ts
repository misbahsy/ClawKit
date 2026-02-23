import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all baileys dependencies before import
vi.mock("baileys", () => {
  const mockSock = {
    ev: {
      on: vi.fn(),
      removeAllListeners: vi.fn(),
    },
    sendMessage: vi.fn().mockResolvedValue({}),
    end: vi.fn(),
  };

  return {
    makeWASocket: vi.fn(() => mockSock),
    useMultiFileAuthState: vi.fn(async () => ({
      state: { creds: {}, keys: {} },
      saveCreds: vi.fn(),
    })),
    DisconnectReason: { loggedOut: 401 },
    downloadMediaMessage: vi.fn(),
  };
});

vi.mock("@hapi/boom", () => ({
  Boom: class Boom extends Error {
    output: any;
    constructor(message: string, options?: any) {
      super(message);
      this.output = { statusCode: options?.statusCode ?? 500 };
    }
  },
}));

vi.mock("pino", () => ({
  default: vi.fn(() => ({})),
}));

vi.mock("qrcode-terminal", () => ({
  default: { generate: vi.fn() },
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, mkdirSync: vi.fn() };
});

import createWhatsAppChannel from "../../registry/channels/whatsapp/index.js";
import { makeWASocket } from "baileys";

describe("whatsapp channel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create channel with correct name", () => {
    const channel = createWhatsAppChannel({});
    expect(channel.name).toBe("whatsapp");
  });

  it("should have all channel interface methods", () => {
    const channel = createWhatsAppChannel({});
    expect(typeof channel.connect).toBe("function");
    expect(typeof channel.onMessage).toBe("function");
    expect(typeof channel.sendMessage).toBe("function");
    expect(typeof channel.sendMedia).toBe("function");
    expect(typeof channel.disconnect).toBe("function");
  });

  it("should set up socket on connect", async () => {
    const channel = createWhatsAppChannel({ authDir: "/tmp/test-auth" });
    await channel.connect({});

    expect(makeWASocket).toHaveBeenCalled();
  });

  it("should register event listeners on connect", async () => {
    const channel = createWhatsAppChannel({});
    await channel.connect({});

    const mockSock = (makeWASocket as any).mock.results[0].value;
    expect(mockSock.ev.on).toHaveBeenCalledWith("creds.update", expect.any(Function));
    expect(mockSock.ev.on).toHaveBeenCalledWith("connection.update", expect.any(Function));
    expect(mockSock.ev.on).toHaveBeenCalledWith("messages.upsert", expect.any(Function));
  });

  it("should accept onMessage callback", () => {
    const channel = createWhatsAppChannel({});
    const callback = vi.fn();
    channel.onMessage(callback);
    // No throw - callback registered
  });

  it("should send text messages via socket", async () => {
    const channel = createWhatsAppChannel({});
    await channel.connect({});

    const mockSock = (makeWASocket as any).mock.results[0].value;

    await channel.sendMessage("123@s.whatsapp.net", { text: "Hello!" });

    expect(mockSock.sendMessage).toHaveBeenCalledWith(
      "123@s.whatsapp.net",
      { text: "Hello!" },
    );
  });

  it("should convert markdown bold to WhatsApp bold", async () => {
    const channel = createWhatsAppChannel({});
    await channel.connect({});

    const mockSock = (makeWASocket as any).mock.results[0].value;

    await channel.sendMessage("123@s.whatsapp.net", { text: "This is **bold** text" });

    expect(mockSock.sendMessage).toHaveBeenCalledWith(
      "123@s.whatsapp.net",
      { text: "This is *bold* text" },
    );
  });

  it("should send image media", async () => {
    const channel = createWhatsAppChannel({});
    await channel.connect({});

    const mockSock = (makeWASocket as any).mock.results[0].value;

    await channel.sendMedia("123@s.whatsapp.net", {
      type: "image",
      data: Buffer.from("fake-image"),
      mimeType: "image/png",
      caption: "A photo",
    });

    expect(mockSock.sendMessage).toHaveBeenCalledWith(
      "123@s.whatsapp.net",
      expect.objectContaining({
        image: expect.any(Buffer),
        caption: "A photo",
        mimetype: "image/png",
      }),
    );
  });

  it("should clean up on disconnect", async () => {
    const channel = createWhatsAppChannel({});
    await channel.connect({});

    const mockSock = (makeWASocket as any).mock.results[0].value;

    await channel.disconnect();

    expect(mockSock.ev.removeAllListeners).toHaveBeenCalledWith("messages.upsert");
    expect(mockSock.ev.removeAllListeners).toHaveBeenCalledWith("connection.update");
    expect(mockSock.ev.removeAllListeners).toHaveBeenCalledWith("creds.update");
    expect(mockSock.end).toHaveBeenCalled();
  });
});
