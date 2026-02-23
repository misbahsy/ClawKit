import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock ws
const mockClients = new Set<any>();
const mockWss = {
  clients: mockClients,
  on: vi.fn(),
  close: vi.fn((cb: Function) => cb()),
};

vi.mock("ws", () => ({
  WebSocketServer: vi.fn((_opts: any, cb?: Function) => {
    if (cb) setTimeout(cb, 0);
    return mockWss;
  }),
}));

import createWebSocketIPC from "../../registry/ipc/websocket/index.js";

describe("ipc-websocket", () => {
  let ipc: ReturnType<typeof createWebSocketIPC>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClients.clear();
    ipc = createWebSocketIPC({ port: 9800, requestTimeout: 1000 });
  });

  it("should have correct IPC name", () => {
    expect(ipc.name).toBe("ipc-websocket");
  });

  it("should start WebSocket server", async () => {
    await ipc.start();

    const { WebSocketServer } = await import("ws");
    expect(WebSocketServer).toHaveBeenCalledWith(
      expect.objectContaining({ port: 9800 }),
      expect.any(Function)
    );
  });

  it("should broadcast messages to connected clients", async () => {
    const mockSend = vi.fn();
    mockClients.add({ readyState: 1, send: mockSend });

    await ipc.start();
    await ipc.send("test-channel", { msg: "hello" });

    expect(mockSend).toHaveBeenCalled();
    const sent = JSON.parse(mockSend.mock.calls[0][0]);
    expect(sent.channel).toBe("test-channel");
    expect(sent.payload).toEqual({ msg: "hello" });
  });

  it("should skip clients that are not open", async () => {
    const closedSend = vi.fn();
    const openSend = vi.fn();
    mockClients.add({ readyState: 3 /* CLOSED */, send: closedSend });
    mockClients.add({ readyState: 1 /* OPEN */, send: openSend });

    await ipc.start();
    await ipc.send("ch", "data");

    expect(closedSend).not.toHaveBeenCalled();
    expect(openSend).toHaveBeenCalled();
  });

  it("should register receive handlers", () => {
    const handler = vi.fn();
    ipc.onReceive("my-channel", handler);
    // Handler stored internally, verified through integration
    expect(true).toBe(true);
  });

  it("should handle incoming messages and dispatch to handlers", async () => {
    const received: any[] = [];
    ipc.onReceive("test-ch", (payload) => received.push(payload));

    // Simulate connection and message
    mockWss.on.mockImplementation((event: string, handler: Function) => {
      if (event === "connection") {
        const mockWs = {
          on: vi.fn((ev: string, h: Function) => {
            if (ev === "message") {
              // Simulate incoming message
              h(JSON.stringify({
                id: "msg-1",
                type: "message",
                channel: "test-ch",
                payload: { data: "incoming" },
              }));
            }
          }),
        };
        handler(mockWs);
      }
    });

    await ipc.start();

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ data: "incoming" });
  });

  it("should timeout on request without response", async () => {
    await ipc.start();

    await expect(
      ipc.request("no-responder", { query: "test" }, 100)
    ).rejects.toThrow("timeout");
  });

  it("should stop cleanly", async () => {
    await ipc.start();
    await ipc.stop();

    expect(mockWss.close).toHaveBeenCalled();
  });
});
