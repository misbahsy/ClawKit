import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

let mockStdin: any;
let mockStdout: any;
let mockChildProcess: any;

const { mockSpawn } = vi.hoisted(() => {
  const mockSpawn = vi.fn();
  return { mockSpawn };
});

vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
}));

import createCodexMcpAgent from "../../registry/agents/codex-mcp/index.js";

function setupMockProcess() {
  mockStdin = { write: vi.fn() };
  mockStdout = new EventEmitter();
  mockChildProcess = new EventEmitter();
  mockChildProcess.stdin = mockStdin;
  mockChildProcess.stdout = mockStdout;
  mockChildProcess.stderr = new EventEmitter();
  mockChildProcess.killed = false;
  mockChildProcess.kill = vi.fn(() => { mockChildProcess.killed = true; });
}

function simulateResponse(id: number, result: any): void {
  setTimeout(() => {
    const response = JSON.stringify({ jsonrpc: "2.0", id, result });
    mockStdout.emit("data", Buffer.from(response + "\n"));
  }, 10);
}

function simulateError(id: number, message: string): void {
  setTimeout(() => {
    const response = JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: { code: -1, message },
    });
    mockStdout.emit("data", Buffer.from(response + "\n"));
  }, 10);
}

describe("agent-codex-mcp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStdin = null;
    mockStdout = null;
    mockChildProcess = null;
    mockSpawn.mockImplementation(() => {
      setupMockProcess();
      return mockChildProcess;
    });
  });

  it("should have correct agent name", () => {
    const agent = createCodexMcpAgent({});
    expect(agent.name).toBe("agent-codex-mcp");
  });

  it("should spawn codex process and get response", async () => {
    const agent = createCodexMcpAgent({});
    const events: any[] = [];

    const runPromise = (async () => {
      for await (const event of agent.run({
        systemPrompt: "You are helpful",
        messages: [{ role: "user", content: "Hello" }],
        tools: [],
      })) {
        events.push(event);
      }
    })();

    // Respond to initialize (id=1)
    await new Promise((r) => setTimeout(r, 20));
    simulateResponse(1, { capabilities: {} });

    // Respond to tools/call (id=2)
    await new Promise((r) => setTimeout(r, 20));
    simulateResponse(2, { content: [{ text: "Hello from Codex!" }] });

    await runPromise;

    expect(events.find((e) => e.type === "text_done")).toBeDefined();
    expect((events.find((e) => e.type === "text_done") as any).text).toBe("Hello from Codex!");
    expect(events.find((e) => e.type === "done")).toBeDefined();
  });

  it("should not spawn process until run is called", () => {
    createCodexMcpAgent({ model: "o4-mini" });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("should handle JSON-RPC errors", async () => {
    const agent = createCodexMcpAgent({});
    const events: any[] = [];

    const runPromise = (async () => {
      for await (const event of agent.run({
        systemPrompt: "test",
        messages: [{ role: "user", content: "test" }],
        tools: [],
      })) {
        events.push(event);
      }
    })();

    await new Promise((r) => setTimeout(r, 20));
    simulateError(1, "Connection failed");

    await runPromise;

    expect(events.find((e) => e.type === "error")).toBeDefined();
    expect(events.find((e) => e.type === "done")).toBeDefined();
  });

  it("should abort and kill child process", async () => {
    const agent = createCodexMcpAgent({});

    // Trigger process spawn by starting run (but don't await)
    const iter = agent.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: [],
    });

    // Let the iterator start
    const nextPromise = (iter as AsyncGenerator).next();
    await new Promise((r) => setTimeout(r, 20));

    // Abort should kill the child process
    agent.abort();

    expect(mockChildProcess.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("should handle process exit", async () => {
    const agent = createCodexMcpAgent({});
    const events: any[] = [];

    const runPromise = (async () => {
      for await (const event of agent.run({
        systemPrompt: "test",
        messages: [{ role: "user", content: "test" }],
        tools: [],
      })) {
        events.push(event);
      }
    })();

    await new Promise((r) => setTimeout(r, 20));

    // Simulate process exit
    mockChildProcess.emit("exit");

    await runPromise;

    expect(events.find((e) => e.type === "error")).toBeDefined();
  });

  it("should write JSON-RPC requests to stdin", async () => {
    const agent = createCodexMcpAgent({});

    const runPromise = (async () => {
      for await (const event of agent.run({
        systemPrompt: "test",
        messages: [{ role: "user", content: "hello" }],
        tools: [],
      })) { /* consume */ }
    })();

    await new Promise((r) => setTimeout(r, 20));

    // Verify stdin.write was called with JSON-RPC format
    expect(mockStdin.write).toHaveBeenCalled();
    const written = mockStdin.write.mock.calls[0][0];
    const parsed = JSON.parse(written.replace("\n", ""));
    expect(parsed.jsonrpc).toBe("2.0");
    expect(parsed.method).toBe("initialize");

    // Complete the run
    simulateResponse(1, { capabilities: {} });
    await new Promise((r) => setTimeout(r, 20));
    simulateResponse(2, "done");
    await runPromise;
  });

  it("should support abort before spawning", () => {
    const agent = createCodexMcpAgent({});
    expect(() => agent.abort()).not.toThrow();
  });

  it("should spawn with npx codex --mcp", async () => {
    const agent = createCodexMcpAgent({});

    const runPromise = (async () => {
      for await (const event of agent.run({
        systemPrompt: "test",
        messages: [{ role: "user", content: "test" }],
        tools: [],
      })) { /* consume */ }
    })();

    await new Promise((r) => setTimeout(r, 20));

    expect(mockSpawn).toHaveBeenCalledWith(
      "npx",
      expect.arrayContaining(["codex", "--mcp"]),
      expect.any(Object),
    );

    // Complete the run
    simulateResponse(1, { capabilities: {} });
    await new Promise((r) => setTimeout(r, 20));
    simulateResponse(2, "ok");
    await runPromise;
  });
});
