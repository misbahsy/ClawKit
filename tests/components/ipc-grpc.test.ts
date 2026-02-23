import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock gRPC modules
const mockAddService = vi.fn();
const mockBindAsync = vi.fn((_addr: string, _creds: any, cb: Function) => cb(null));
const mockTryShutdown = vi.fn((cb: Function) => cb());

const mockServer = {
  addService: mockAddService,
  bindAsync: mockBindAsync,
  tryShutdown: mockTryShutdown,
};

const mockService = { Send: {}, Request: {} };

vi.mock("@grpc/grpc-js", () => ({
  Server: vi.fn(() => mockServer),
  ServerCredentials: {
    createInsecure: vi.fn(() => ({})),
  },
  loadPackageDefinition: vi.fn(() => ({
    clawkit: {
      ClawKitIPC: {
        service: mockService,
      },
    },
  })),
}));

vi.mock("@grpc/proto-loader", () => ({
  loadSync: vi.fn(() => ({})),
}));

import createGrpcIPC from "../../registry/ipc/grpc/index.js";

describe("ipc-grpc", () => {
  let ipc: ReturnType<typeof createGrpcIPC>;

  beforeEach(() => {
    vi.clearAllMocks();
    ipc = createGrpcIPC({ port: 50051, requestTimeout: 1000 });
  });

  it("should have the correct name", () => {
    expect(ipc.name).toBe("ipc-grpc");
  });

  it("should start gRPC server", async () => {
    await ipc.start();

    const grpc = await import("@grpc/grpc-js");
    expect(grpc.Server).toHaveBeenCalled();
    expect(mockAddService).toHaveBeenCalledWith(mockService, expect.any(Object));
    expect(mockBindAsync).toHaveBeenCalledWith(
      "0.0.0.0:50051",
      expect.anything(),
      expect.any(Function),
    );
  });

  it("should register receive handlers", () => {
    const handler = vi.fn();
    ipc.onReceive("test-channel", handler);
    // Verified indirectly through send dispatch
  });

  it("should dispatch local messages to handlers on send", async () => {
    const received: any[] = [];
    ipc.onReceive("channel-1", (payload) => received.push(payload));

    await ipc.send("channel-1", { msg: "hello" });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ msg: "hello" });
  });

  it("should dispatch to multiple handlers", async () => {
    const h1: any[] = [];
    const h2: any[] = [];
    ipc.onReceive("ch", (p) => h1.push(p));
    ipc.onReceive("ch", (p) => h2.push(p));

    await ipc.send("ch", "data");

    expect(h1).toHaveLength(1);
    expect(h2).toHaveLength(1);
  });

  it("should not dispatch to handlers of other channels", async () => {
    const received: any[] = [];
    ipc.onReceive("channel-A", (p) => received.push(p));

    await ipc.send("channel-B", "data");

    expect(received).toHaveLength(0);
  });

  it("should handle gRPC Send method calls", async () => {
    await ipc.start();

    const received: any[] = [];
    ipc.onReceive("grpc-channel", (p) => received.push(p));

    // Get the service implementation
    const serviceImpl = mockAddService.mock.calls[0][1];

    // Simulate a gRPC Send call
    const callback = vi.fn();
    serviceImpl.Send(
      {
        request: {
          id: "msg-1",
          channel: "grpc-channel",
          payload: JSON.stringify({ data: "from-grpc" }),
          timestamp: new Date().toISOString(),
        },
      },
      callback,
    );

    expect(callback).toHaveBeenCalledWith(null, { ok: true });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ data: "from-grpc" });
  });

  it("should handle gRPC Request method calls", async () => {
    await ipc.start();

    const received: any[] = [];
    ipc.onReceive("req-channel", (p) => received.push(p));

    const serviceImpl = mockAddService.mock.calls[0][1];
    const callback = vi.fn();

    serviceImpl.Request(
      {
        request: {
          id: "req-1",
          channel: "req-channel",
          payload: JSON.stringify({ query: "test" }),
          correlationId: "corr-1",
          timestamp: new Date().toISOString(),
        },
      },
      callback,
    );

    expect(callback).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ channel: "req-channel" }),
    );
  });

  it("should timeout on request without response", async () => {
    await expect(
      ipc.request("no-responder", { data: "test" }, 100),
    ).rejects.toThrow("timeout");
  });

  it("should stop cleanly and reject pending requests", async () => {
    await ipc.start();

    const requestPromise = ipc.request("ch", { data: "test" }, 5000);

    await new Promise((r) => setTimeout(r, 50));
    await ipc.stop();

    await expect(requestPromise).rejects.toThrow("IPC stopped");
    expect(mockTryShutdown).toHaveBeenCalled();
  });

  it("should handle bind errors", async () => {
    mockBindAsync.mockImplementationOnce((_addr: string, _creds: any, cb: Function) =>
      cb(new Error("Port in use")),
    );

    await expect(ipc.start()).rejects.toThrow("Port in use");
  });
});
