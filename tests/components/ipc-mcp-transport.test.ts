import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock MCP SDK
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockClose = vi.fn().mockResolvedValue(undefined);
const mockNotification = vi.fn().mockResolvedValue(undefined);
const mockRequest = vi.fn().mockResolvedValue({ result: "ok" });
const mockSetNotificationHandler = vi.fn();

const MockClient = vi.fn().mockImplementation(() => ({
  connect: mockConnect,
  close: mockClose,
  notification: mockNotification,
  request: mockRequest,
  setNotificationHandler: mockSetNotificationHandler,
}));

const MockStdioTransport = vi.fn().mockImplementation(() => ({
  close: vi.fn().mockResolvedValue(undefined),
}));

const MockHTTPTransport = vi.fn().mockImplementation(() => ({
  close: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: MockClient,
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: MockStdioTransport,
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: MockHTTPTransport,
}));

import createMCPTransportIPC from "../../registry/ipc/mcp-transport/index.js";

describe("ipc-mcp-transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have the correct name", () => {
    const ipc = createMCPTransportIPC({ transport: "stdio", command: "npx" });
    expect(ipc.name).toBe("ipc-mcp-transport");
  });

  it("should start with stdio transport", async () => {
    const ipc = createMCPTransportIPC({
      transport: "stdio",
      command: "npx",
      args: ["some-server"],
    });

    await ipc.start();

    expect(MockClient).toHaveBeenCalledWith(
      expect.objectContaining({ name: "clawkit-ipc" }),
      expect.anything(),
    );
    expect(MockStdioTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "npx",
        args: ["some-server"],
      }),
    );
    expect(mockConnect).toHaveBeenCalled();
    expect(mockSetNotificationHandler).toHaveBeenCalled();

    await ipc.stop();
  });

  it("should start with streamable-http transport", async () => {
    const ipc = createMCPTransportIPC({
      transport: "streamable-http",
      url: "http://localhost:3000/mcp",
    });

    await ipc.start();

    expect(MockHTTPTransport).toHaveBeenCalled();
    expect(mockConnect).toHaveBeenCalled();

    await ipc.stop();
  });

  it("should error if stdio transport missing command", async () => {
    const ipc = createMCPTransportIPC({ transport: "stdio" });

    await expect(ipc.start()).rejects.toThrow("command is required");
  });

  it("should error if streamable-http transport missing url", async () => {
    const ipc = createMCPTransportIPC({ transport: "streamable-http" });

    await expect(ipc.start()).rejects.toThrow("url is required");
  });

  it("should send notifications via MCP client", async () => {
    const ipc = createMCPTransportIPC({ transport: "stdio", command: "npx" });
    await ipc.start();

    await ipc.send("test-channel", { msg: "hello" });

    expect(mockNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "notifications/message",
        params: expect.objectContaining({
          channel: "test-channel",
          payload: { msg: "hello" },
        }),
      }),
    );

    await ipc.stop();
  });

  it("should fall back to local dispatch if notification fails", async () => {
    mockNotification.mockRejectedValueOnce(new Error("Not connected"));

    const received: any[] = [];
    const ipc = createMCPTransportIPC({ transport: "stdio", command: "npx" });
    await ipc.start();

    ipc.onReceive("fallback-ch", (p) => received.push(p));
    await ipc.send("fallback-ch", { data: "local" });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ data: "local" });

    await ipc.stop();
  });

  it("should register receive handlers", async () => {
    const ipc = createMCPTransportIPC({ transport: "stdio", command: "npx" });
    const handler = vi.fn();
    ipc.onReceive("channel", handler);
    // Verified through notification handler dispatch
  });

  it("should dispatch incoming notifications to channel handlers", async () => {
    const received: any[] = [];
    const ipc = createMCPTransportIPC({ transport: "stdio", command: "npx" });
    ipc.onReceive("my-channel", (p) => received.push(p));

    await ipc.start();

    // Get the notification handler that was registered
    const notifHandler = mockSetNotificationHandler.mock.calls[0][1];

    // Simulate incoming notification
    await notifHandler({
      params: {
        channel: "my-channel",
        payload: { data: "incoming" },
      },
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ data: "incoming" });

    await ipc.stop();
  });

  it("should make requests via MCP client", async () => {
    mockRequest.mockResolvedValue({ answer: 42 });

    const ipc = createMCPTransportIPC({
      transport: "stdio",
      command: "npx",
      requestTimeout: 2000,
    });
    await ipc.start();

    const result = await ipc.request("req-channel", { query: "test" });

    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "clawkit/request",
        params: expect.objectContaining({
          channel: "req-channel",
          payload: { query: "test" },
        }),
      }),
      undefined,
    );
    expect(result).toEqual({ answer: 42 });

    await ipc.stop();
  });

  it("should error if sending before start", async () => {
    const ipc = createMCPTransportIPC({ transport: "stdio", command: "npx" });

    await expect(ipc.send("ch", "data")).rejects.toThrow("not started");
  });

  it("should error if requesting before start", async () => {
    const ipc = createMCPTransportIPC({ transport: "stdio", command: "npx" });

    await expect(ipc.request("ch", "data")).rejects.toThrow("not started");
  });

  it("should reject pending requests on stop", async () => {
    mockRequest.mockReturnValue(new Promise(() => {})); // never resolves

    const ipc = createMCPTransportIPC({
      transport: "stdio",
      command: "npx",
      requestTimeout: 5000,
    });
    await ipc.start();

    const requestPromise = ipc.request("ch", { data: "test" }, 5000);

    await new Promise((r) => setTimeout(r, 50));
    await ipc.stop();

    await expect(requestPromise).rejects.toThrow("IPC stopped");
  });

  it("should stop cleanly and close client", async () => {
    const ipc = createMCPTransportIPC({ transport: "stdio", command: "npx" });
    await ipc.start();
    await ipc.stop();

    expect(mockClose).toHaveBeenCalled();
  });

  it("should error on unsupported transport type", async () => {
    const ipc = createMCPTransportIPC({ transport: "invalid" as any, command: "npx" });

    await expect(ipc.start()).rejects.toThrow("Unsupported transport");
  });
});
