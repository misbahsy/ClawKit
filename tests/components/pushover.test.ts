import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import createPushoverTool from "../../registry/tools/pushover/index.js";

describe("tool-pushover", () => {
  const context = { workspaceDir: ".", sessionId: "test-session" };
  const config = { userKey: "test-user-key", apiToken: "test-api-token" };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should have the correct tool interface", () => {
    const tool = createPushoverTool(config);
    expect(tool.name).toBe("pushover");
    expect(tool.description).toBeTruthy();
    expect(tool.parameters.required).toContain("message");
    expect(tool.parameters.properties).toHaveProperty("title");
    expect(tool.parameters.properties).toHaveProperty("priority");
    expect(tool.parameters.properties).toHaveProperty("device");
  });

  it("should send a basic notification", async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 1, request: "req-123" }),
    });

    const tool = createPushoverTool(config);
    const result = await tool.execute({ message: "Hello world" }, context);

    expect(fetch).toHaveBeenCalledWith(
      "https://api.pushover.net/1/messages.json",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.token).toBe("test-api-token");
    expect(body.user).toBe("test-user-key");
    expect(body.message).toBe("Hello world");
    expect(result.output).toContain("Notification sent");
  });

  it("should include optional title and priority", async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 1, request: "req-456" }),
    });

    const tool = createPushoverTool(config);
    await tool.execute(
      { message: "Alert", title: "Warning", priority: 1 },
      context,
    );

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.title).toBe("Warning");
    expect(body.priority).toBe(1);
  });

  it("should add retry/expire for emergency priority", async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 1, request: "req-789" }),
    });

    const tool = createPushoverTool(config);
    await tool.execute(
      { message: "CRITICAL", priority: 2 },
      context,
    );

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.priority).toBe(2);
    expect(body.retry).toBe(60);
    expect(body.expire).toBe(3600);
  });

  it("should use device from args over config default", async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 1, request: "req-abc" }),
    });

    const tool = createPushoverTool({ ...config, defaultDevice: "phone" });
    await tool.execute({ message: "Test", device: "tablet" }, context);

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.device).toBe("tablet");
  });

  it("should use config defaultDevice when no device arg", async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 1, request: "req-def" }),
    });

    const tool = createPushoverTool({ ...config, defaultDevice: "phone" });
    await tool.execute({ message: "Test" }, context);

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.device).toBe("phone");
  });

  it("should handle Pushover API errors", async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ status: 0, errors: ["invalid token"] }),
    });

    const tool = createPushoverTool(config);
    const result = await tool.execute({ message: "Fail" }, context);

    expect(result.error).toContain("Pushover error");
    expect(result.error).toContain("invalid token");
  });

  it("should handle network failures", async () => {
    (fetch as any).mockRejectedValue(new Error("Network error"));

    const tool = createPushoverTool(config);
    const result = await tool.execute({ message: "Unreachable" }, context);

    expect(result.error).toContain("Network error");
  });

  it("should return metadata on success", async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 1, request: "req-meta" }),
    });

    const tool = createPushoverTool(config);
    const result = await tool.execute({ message: "Metadata test" }, context);

    expect(result.metadata).toEqual({ request: "req-meta", status: 1 });
  });
});
