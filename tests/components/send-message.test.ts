import { describe, it, expect, vi } from "vitest";
import createSendMessageTool from "../../registry/tools/send-message/index.js";

describe("tool-send-message", () => {
  const baseContext = { workspaceDir: ".", sessionId: "test-session" };

  it("should create a tool with correct interface", () => {
    const tool = createSendMessageTool({});
    expect(tool.name).toBe("send_message");
    expect(tool.description).toBeTruthy();
    expect(tool.parameters.required).toEqual(["channel", "to", "text"]);
    expect(tool.parameters.properties).toHaveProperty("channel");
    expect(tool.parameters.properties).toHaveProperty("to");
    expect(tool.parameters.properties).toHaveProperty("text");
  });

  it("should send via context.sendMessage when available", async () => {
    const sendMessage = vi.fn().mockResolvedValue("delivered");

    const tool = createSendMessageTool({});
    const result = await tool.execute(
      { channel: "discord", to: "user123", text: "Hello there" },
      { ...baseContext, sendMessage },
    );

    expect(sendMessage).toHaveBeenCalledWith("discord", {
      action: "send",
      to: "user123",
      text: "Hello there",
      fromSession: "test-session",
    });
    expect(result.output).toBe("delivered");
    expect(result.metadata?.channel).toBe("discord");
  });

  it("should return string response from sendMessage directly", async () => {
    const sendMessage = vi.fn().mockResolvedValue("Message ID: msg_123");

    const tool = createSendMessageTool({});
    const result = await tool.execute(
      { channel: "slack", to: "#general", text: "Announcement" },
      { ...baseContext, sendMessage },
    );

    expect(result.output).toBe("Message ID: msg_123");
  });

  it("should error when no sendMessage available", async () => {
    const tool = createSendMessageTool({});
    const result = await tool.execute(
      { channel: "telegram", to: "chat_456", text: "Hello" },
      baseContext,
    );

    expect(result.error).toContain("No messaging runtime available");
    expect(result.metadata?.intent).toBe("send_message");
  });

  it("should handle sendMessage errors", async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error("Channel not found"));

    const tool = createSendMessageTool({});
    const result = await tool.execute(
      { channel: "unknown", to: "x", text: "test" },
      { ...baseContext, sendMessage },
    );

    expect(result.error).toContain("Channel not found");
  });
});
