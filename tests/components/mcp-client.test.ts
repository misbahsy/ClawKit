import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the MCP SDK
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({
      tools: [
        {
          name: "echo",
          description: "Echo input back",
          inputSchema: { type: "object", properties: { text: { type: "string" } } },
        },
        {
          name: "add",
          description: "Add two numbers",
          inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } },
        },
      ],
    }),
    callTool: vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "tool output" }],
    }),
  })),
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(() => ({})),
}));

import createMCPSkillsManager from "../../registry/skills/mcp-client/index.js";

describe("skills-mcp-client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create manager with correct name", () => {
    const manager = createMCPSkillsManager({});
    expect(manager.name).toBe("skills-mcp-client");
  });

  it("should load skills from stdio MCP server", async () => {
    const manager = createMCPSkillsManager({});

    const skills = await manager.loadSkills({
      mcp: [{ name: "test-server", transport: "stdio", command: "node server.js" }],
    });

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("test-server");
    expect(skills[0].type).toBe("mcp");
    expect(skills[0].tools).toHaveLength(2);
  });

  it("should prefix tool names with server name", async () => {
    const manager = createMCPSkillsManager({});

    await manager.loadSkills({
      mcp: [{ name: "myserver", transport: "stdio", command: "node server.js" }],
    });

    const tools = manager.getTools();
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe("myserver__echo");
    expect(tools[1].name).toBe("myserver__add");
  });

  it("should execute tool calls through MCP client", async () => {
    const manager = createMCPSkillsManager({});

    await manager.loadSkills({
      mcp: [{ name: "srv", transport: "stdio", command: "node server.js" }],
    });

    const tools = manager.getTools();
    const result = await tools[0].execute({ text: "hello" }, { workspaceDir: ".", sessionId: "s1" });

    expect(result.output).toBe("tool output");
  });

  it("should return MCP connections", async () => {
    const manager = createMCPSkillsManager({});

    await manager.loadSkills({
      mcp: [{ name: "conn-test", transport: "stdio", command: "node server.js" }],
    });

    const connections = manager.getMCPConnections();
    expect(connections).toHaveLength(1);
    expect(connections[0].name).toBe("conn-test");
    expect(connections[0].transport).toBe("stdio");
    expect(connections[0].tools).toHaveLength(2);
  });

  it("should return prompt sections for connected servers", async () => {
    const manager = createMCPSkillsManager({});

    await manager.loadSkills({
      mcp: [{ name: "prompt-srv", transport: "stdio", command: "node server.js" }],
    });

    const sections = manager.getPromptSections();
    expect(sections).toHaveLength(1);
    expect(sections[0].name).toBe("prompt-srv");
    expect(sections[0].content).toContain("prompt-srv__echo");
  });

  it("should handle multiple MCP servers", async () => {
    const manager = createMCPSkillsManager({});

    const skills = await manager.loadSkills({
      mcp: [
        { name: "server-a", transport: "stdio", command: "node a.js" },
        { name: "server-b", transport: "stdio", command: "node b.js" },
      ],
    });

    expect(skills).toHaveLength(2);
    expect(manager.getTools()).toHaveLength(4);
    expect(manager.getMCPConnections()).toHaveLength(2);
  });

  it("should load skills from HTTP transport", async () => {
    const manager = createMCPSkillsManager({});

    const skills = await manager.loadSkills({
      mcp: [{ name: "http-server", transport: "streamable-http", url: "http://localhost:3000/mcp" }],
    });

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("http-server");
  });

  it("should skip servers with invalid config", async () => {
    const manager = createMCPSkillsManager({});

    // No command or url
    const skills = await manager.loadSkills({
      mcp: [{ name: "bad-server", transport: "stdio" }],
    });

    expect(skills).toHaveLength(0);
    expect(manager.getTools()).toHaveLength(0);
  });

  it("should return empty arrays when no skills loaded", () => {
    const manager = createMCPSkillsManager({});

    expect(manager.getTools()).toHaveLength(0);
    expect(manager.getMCPConnections()).toHaveLength(0);
    expect(manager.getPromptSections()).toHaveLength(0);
  });

  it("should clear previous skills on reload", async () => {
    const manager = createMCPSkillsManager({});

    await manager.loadSkills({
      mcp: [{ name: "first", transport: "stdio", command: "node a.js" }],
    });
    expect(manager.getTools()).toHaveLength(2);

    await manager.loadSkills({ mcp: [] });
    expect(manager.getTools()).toHaveLength(0);
  });
});
