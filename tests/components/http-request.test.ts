import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import createHttpRequestTool from "../../registry/tools/http-request/index.js";

describe("tool-http-request", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const context = { workspaceDir: ".", sessionId: "test-session" };

  function mockFetchResponse(body: string, status = 200, headers: Record<string, string> = {}) {
    const headerMap = new Map(Object.entries(headers));
    (fetch as any).mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      headers: {
        get: (k: string) => headerMap.get(k) ?? null,
        forEach: (cb: (v: string, k: string) => void) => headerMap.forEach((v, k) => cb(v, k)),
      },
      text: async () => body,
    });
  }

  it("should create a tool with correct interface", () => {
    const tool = createHttpRequestTool({});
    expect(tool.name).toBe("http_request");
    expect(tool.description).toBeTruthy();
    expect(tool.parameters.required).toContain("url");
    expect(tool.parameters.properties.method.enum).toContain("POST");
    expect(tool.parameters.properties).toHaveProperty("headers");
    expect(tool.parameters.properties).toHaveProperty("body");
    expect(tool.parameters.properties).toHaveProperty("auth");
  });

  it("should make a GET request by default", async () => {
    mockFetchResponse('{"result": "ok"}');

    const tool = createHttpRequestTool({});
    const result = await tool.execute({ url: "https://api.example.com" }, context);

    expect(result.output).toContain("result");
    expect(result.metadata?.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("should make a POST request with body", async () => {
    mockFetchResponse('{"created": true}', 201);

    const tool = createHttpRequestTool({});
    const result = await tool.execute(
      {
        url: "https://api.example.com/items",
        method: "POST",
        body: '{"name": "test"}',
      },
      context,
    );

    expect(result.output).toContain("created");
    expect(result.metadata?.status).toBe(201);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com/items",
      expect.objectContaining({
        method: "POST",
        body: '{"name": "test"}',
      }),
    );
  });

  it("should apply bearer auth", async () => {
    mockFetchResponse("authed");

    const tool = createHttpRequestTool({});
    await tool.execute(
      {
        url: "https://api.example.com",
        auth: { type: "bearer", token: "my-token" },
      },
      context,
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer my-token" }),
      }),
    );
  });

  it("should apply basic auth", async () => {
    mockFetchResponse("authed");

    const tool = createHttpRequestTool({});
    await tool.execute(
      {
        url: "https://api.example.com",
        auth: { type: "basic", username: "user", password: "pass" },
      },
      context,
    );

    const expectedAuth = "Basic " + Buffer.from("user:pass").toString("base64");
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: expectedAuth }),
      }),
    );
  });

  it("should auto-detect JSON content-type", async () => {
    mockFetchResponse("ok");

    const tool = createHttpRequestTool({});
    await tool.execute(
      {
        url: "https://api.example.com",
        method: "POST",
        body: '{"key": "val"}',
      },
      context,
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com",
      expect.objectContaining({
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );
  });

  it("should handle fetch errors", async () => {
    (fetch as any).mockRejectedValue(new Error("Connection refused"));

    const tool = createHttpRequestTool({});
    const result = await tool.execute({ url: "https://unreachable.test" }, context);

    expect(result.error).toContain("Connection refused");
  });
});
