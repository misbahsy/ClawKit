import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import createComposioTool from "../../registry/tools/composio/index.js";

describe("tool-composio", () => {
  const context = { workspaceDir: ".", sessionId: "test-session" };
  let mockExecuteAction: ReturnType<typeof vi.fn>;
  let mockModule: any;

  beforeEach(() => {
    mockExecuteAction = vi.fn();
    mockModule = {
      Composio: vi.fn().mockImplementation(() => ({
        executeAction: mockExecuteAction,
      })),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should create a tool with correct name", () => {
    const tool = createComposioTool({ apiKey: "test-key" });
    expect(tool.name).toBe("composio");
  });

  it("should have a description mentioning 100+ apps", () => {
    const tool = createComposioTool({ apiKey: "test-key" });
    expect(tool.description).toContain("100+");
  });

  it("should require action parameter", () => {
    const tool = createComposioTool({ apiKey: "test-key" });
    expect(tool.parameters.required).toContain("action");
    expect(tool.parameters.properties).toHaveProperty("action");
    expect(tool.parameters.properties).toHaveProperty("params");
  });

  it("should return error when API key is not set", async () => {
    const originalEnv = process.env.COMPOSIO_API_KEY;
    delete process.env.COMPOSIO_API_KEY;

    const tool = createComposioTool({});
    const result = await tool.execute({ action: "github.create_issue" }, context);

    expect(result.error).toContain("COMPOSIO_API_KEY not set");
    expect(result.output).toBe("");

    if (originalEnv) process.env.COMPOSIO_API_KEY = originalEnv;
  });

  it("should call executeAction with correct arguments", async () => {
    mockExecuteAction.mockResolvedValue({ success: true, id: 42 });

    const tool = createComposioTool({ apiKey: "test-key", apps: ["acc_123"], _composioModule: mockModule });
    const result = await tool.execute(
      { action: "github.create_issue", params: { title: "Bug", body: "Details" } },
      context,
    );

    expect(mockExecuteAction).toHaveBeenCalledWith({
      action: "github.create_issue",
      params: { title: "Bug", body: "Details" },
      connectedAccountId: "acc_123",
    });
    expect(result.output).toContain('"success": true');
    expect(result.error).toBeUndefined();
  });

  it("should handle string result from executeAction", async () => {
    mockExecuteAction.mockResolvedValue("Message sent successfully");

    const tool = createComposioTool({ apiKey: "test-key", _composioModule: mockModule });
    const result = await tool.execute(
      { action: "slack.send_message", params: { channel: "#general", text: "Hello" } },
      context,
    );

    expect(result.output).toBe("Message sent successfully");
  });

  it("should default params to empty object", async () => {
    mockExecuteAction.mockResolvedValue({ ok: true });

    const tool = createComposioTool({ apiKey: "test-key", _composioModule: mockModule });
    await tool.execute({ action: "github.list_repos" }, context);

    expect(mockExecuteAction).toHaveBeenCalledWith(
      expect.objectContaining({ params: {} }),
    );
  });

  it("should handle Composio client errors", async () => {
    mockExecuteAction.mockRejectedValue(new Error("Rate limit exceeded"));

    const tool = createComposioTool({ apiKey: "test-key", _composioModule: mockModule });
    const result = await tool.execute(
      { action: "gmail.send_email", params: { to: "user@example.com" } },
      context,
    );

    expect(result.error).toContain("Rate limit exceeded");
    expect(result.output).toBe("");
  });

  it("should read API key from environment variable", async () => {
    const originalEnv = process.env.COMPOSIO_API_KEY;
    process.env.COMPOSIO_API_KEY = "env-key-123";

    mockExecuteAction.mockResolvedValue({ done: true });

    const tool = createComposioTool({ _composioModule: mockModule });
    const result = await tool.execute({ action: "notion.create_page" }, context);

    expect(result.output).toContain("done");
    expect(result.error).toBeUndefined();

    if (originalEnv) {
      process.env.COMPOSIO_API_KEY = originalEnv;
    } else {
      delete process.env.COMPOSIO_API_KEY;
    }
  });

  it("should use first app as connectedAccountId", async () => {
    mockExecuteAction.mockResolvedValue("ok");

    const tool = createComposioTool({ apiKey: "key", apps: ["my-account-id"], _composioModule: mockModule });
    await tool.execute({ action: "test.action" }, context);

    expect(mockExecuteAction).toHaveBeenCalledWith(
      expect.objectContaining({ connectedAccountId: "my-account-id" }),
    );
  });
});
