import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockListen = vi.fn((_port: number, _host: string, cb: () => void) => { cb(); });
const mockClose = vi.fn((cb: () => void) => { cb(); });
const mockOn = vi.fn();
let requestHandler: ((req: any, res: any) => void) | null = null;

vi.mock("node:http", () => ({
  createServer: vi.fn((handler: any) => {
    requestHandler = handler;
    return {
      listen: mockListen,
      close: mockClose,
      on: mockOn,
    };
  }),
}));

import createWebhookScheduler from "../../registry/scheduler/webhook/index.js";

function makeRequest(method: string, url: string, body?: string): { req: any; res: any; getResponse: () => { statusCode: number; body: string } } {
  const chunks: string[] = [];
  let endCallback: (() => void) | null = null;
  let dataCallback: ((chunk: string) => void) | null = null;

  const req = {
    method,
    url,
    headers: { "content-type": "application/json" },
    on: vi.fn((event: string, cb: any) => {
      if (event === "data") dataCallback = cb;
      if (event === "end") endCallback = cb;
    }),
  };

  let responseStatusCode = 0;
  let responseBody = "";

  const res = {
    writeHead: vi.fn((code: number) => { responseStatusCode = code; }),
    end: vi.fn((data: string) => { responseBody = data; }),
  };

  // Simulate data/end events after a tick
  setTimeout(() => {
    if (body && dataCallback) dataCallback(body);
    if (endCallback) endCallback();
  }, 5);

  return {
    req,
    res,
    getResponse: () => ({ statusCode: responseStatusCode, body: responseBody }),
  };
}

describe("scheduler-webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestHandler = null;
  });

  it("should have correct name", () => {
    const scheduler = createWebhookScheduler({});
    expect(scheduler.name).toBe("scheduler-webhook");
  });

  it("should add a webhook job and return an id", async () => {
    const scheduler = createWebhookScheduler({});
    const id = await scheduler.addJob({
      webhook: { path: "/webhook/deploy" },
      handler: vi.fn(),
    });

    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
  });

  it("should add a job with custom id", async () => {
    const scheduler = createWebhookScheduler({});
    const id = await scheduler.addJob({
      id: "deploy-hook",
      webhook: { path: "/webhook/deploy-hook" },
      handler: vi.fn(),
    });

    expect(id).toBe("deploy-hook");
  });

  it("should reject duplicate job ids", async () => {
    const scheduler = createWebhookScheduler({});
    await scheduler.addJob({ id: "dup", webhook: { path: "/w" }, handler: vi.fn() });

    await expect(
      scheduler.addJob({ id: "dup", webhook: { path: "/w" }, handler: vi.fn() }),
    ).rejects.toThrow("already exists");
  });

  it("should start HTTP server", async () => {
    const scheduler = createWebhookScheduler({ port: 4000, host: "localhost" });
    await scheduler.start();

    expect(mockListen).toHaveBeenCalledWith(4000, "localhost", expect.any(Function));
  });

  it("should stop HTTP server", async () => {
    const scheduler = createWebhookScheduler({});
    await scheduler.start();
    await scheduler.stop();

    expect(mockClose).toHaveBeenCalled();
  });

  it("should trigger handler on POST request", async () => {
    const handler = vi.fn();
    const scheduler = createWebhookScheduler({});

    await scheduler.addJob({
      id: "test-job",
      webhook: { path: "/webhook/test-job" },
      handler,
    });

    await scheduler.start();

    const { req, res } = makeRequest("POST", "/webhook/test-job", '{"action":"deploy"}');
    requestHandler!(req, res);

    await new Promise((r) => setTimeout(r, 20));

    expect(handler).toHaveBeenCalled();
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
  });

  it("should return 404 for unknown job", async () => {
    const scheduler = createWebhookScheduler({});
    await scheduler.start();

    const { req, res } = makeRequest("POST", "/webhook/unknown");
    requestHandler!(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
  });

  it("should return 404 for non-webhook paths", async () => {
    const scheduler = createWebhookScheduler({});
    await scheduler.start();

    const { req, res } = makeRequest("GET", "/health");
    requestHandler!(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
  });

  it("should return 405 for wrong HTTP method", async () => {
    const scheduler = createWebhookScheduler({});

    await scheduler.addJob({
      id: "post-only",
      webhook: { path: "/webhook/post-only", method: "POST" },
      handler: vi.fn(),
    });

    await scheduler.start();

    const { req, res } = makeRequest("GET", "/webhook/post-only");
    requestHandler!(req, res);

    // GET request before body events fire
    await new Promise((r) => setTimeout(r, 10));

    expect(res.writeHead).toHaveBeenCalledWith(405, expect.any(Object));
  });

  it("should track runCount", async () => {
    const handler = vi.fn();
    const scheduler = createWebhookScheduler({});

    await scheduler.addJob({
      id: "counter",
      webhook: { path: "/webhook/counter" },
      handler,
    });

    await scheduler.start();

    // Fire twice
    const { req: req1, res: res1 } = makeRequest("POST", "/webhook/counter");
    requestHandler!(req1, res1);
    await new Promise((r) => setTimeout(r, 20));

    const { req: req2, res: res2 } = makeRequest("POST", "/webhook/counter");
    requestHandler!(req2, res2);
    await new Promise((r) => setTimeout(r, 20));

    const jobs = await scheduler.listJobs();
    expect(jobs[0].runCount).toBe(2);
  });

  it("should list jobs with webhook type", async () => {
    const scheduler = createWebhookScheduler({});

    await scheduler.addJob({ id: "j1", webhook: { path: "/w1" }, handler: vi.fn() });
    await scheduler.addJob({ id: "j2", webhook: { path: "/w2" }, handler: vi.fn() });

    const jobs = await scheduler.listJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs[0].type).toBe("webhook");
    expect(jobs[1].type).toBe("webhook");
  });

  it("should remove a job", async () => {
    const scheduler = createWebhookScheduler({});
    await scheduler.addJob({ id: "removable", webhook: { path: "/w" }, handler: vi.fn() });

    let jobs = await scheduler.listJobs();
    expect(jobs).toHaveLength(1);

    await scheduler.removeJob("removable");
    jobs = await scheduler.listJobs();
    expect(jobs).toHaveLength(0);
  });

  it("should handle handler errors with 500", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("Handler failed"));
    const scheduler = createWebhookScheduler({});

    await scheduler.addJob({
      id: "failing",
      webhook: { path: "/webhook/failing" },
      handler,
    });

    await scheduler.start();

    const { req, res } = makeRequest("POST", "/webhook/failing");
    requestHandler!(req, res);
    await new Promise((r) => setTimeout(r, 20));

    expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
  });

  it("should use default port and host", async () => {
    const scheduler = createWebhookScheduler({});
    await scheduler.start();

    expect(mockListen).toHaveBeenCalledWith(3100, "0.0.0.0", expect.any(Function));
  });
});
