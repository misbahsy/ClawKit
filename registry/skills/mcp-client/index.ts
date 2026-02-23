import type {
  SkillsManager, SkillsConfig, LoadedSkill, PromptSection,
  Tool, ToolResult, ToolContext, MCPConnection, MCPServerConfig,
} from "clawkit:types";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

interface ActiveConnection {
  name: string;
  client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
  tools: Tool[];
  mcpConnection: MCPConnection;
}

export default function createMCPSkillsManager(_config: SkillsConfig): SkillsManager {
  const connections: ActiveConnection[] = [];
  const allTools: Tool[] = [];
  const loadedSkills: LoadedSkill[] = [];

  async function connectServer(serverConfig: MCPServerConfig): Promise<ActiveConnection | null> {
    try {
      let transport: StdioClientTransport | StreamableHTTPClientTransport;

      if (serverConfig.transport === "stdio" && serverConfig.command) {
        const parts = serverConfig.command.split(" ");
        transport = new StdioClientTransport({
          command: parts[0],
          args: parts.slice(1),
        });
      } else if ((serverConfig.transport === "streamable-http" || serverConfig.transport === "sse") && serverConfig.url) {
        transport = new StreamableHTTPClientTransport(new URL(serverConfig.url));
      } else {
        console.warn(`MCP server "${serverConfig.name}": invalid transport config, skipping`);
        return null;
      }

      const client = new Client({ name: "clawkit", version: "1.0.0" }, { capabilities: {} });
      await client.connect(transport);

      const { tools: mcpTools } = await client.listTools();
      const wrappedTools: Tool[] = mcpTools.map((t) => ({
        name: `${serverConfig.name}__${t.name}`,
        description: t.description ?? "",
        parameters: (t.inputSchema as Record<string, any>) ?? {},
        async execute(args: Record<string, any>, _context: ToolContext): Promise<ToolResult> {
          try {
            const result = await client.callTool({ name: t.name, arguments: args });
            const textParts = (result.content as any[])
              .filter((c: any) => c.type === "text")
              .map((c: any) => c.text);
            return { output: textParts.join("\n") };
          } catch (err: any) {
            return { output: "", error: err.message };
          }
        },
      }));

      const mcpConnection: MCPConnection = {
        name: serverConfig.name,
        transport: serverConfig.transport,
        command: serverConfig.command,
        url: serverConfig.url,
        tools: wrappedTools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      };

      return { name: serverConfig.name, client, transport, tools: wrappedTools, mcpConnection };
    } catch (err: any) {
      console.warn(`MCP server "${serverConfig.name}" unavailable: ${err.message}`);
      return null;
    }
  }

  return {
    name: "skills-mcp-client",

    async loadSkills(config: SkillsConfig): Promise<LoadedSkill[]> {
      loadedSkills.length = 0;
      allTools.length = 0;
      connections.length = 0;

      if (config.mcp) {
        for (const serverConfig of config.mcp) {
          const conn = await connectServer(serverConfig);
          if (conn) {
            connections.push(conn);
            allTools.push(...conn.tools);
            loadedSkills.push({
              name: conn.name,
              type: "mcp",
              tools: conn.tools,
              mcpServer: conn.mcpConnection,
            });
          }
        }
      }

      return loadedSkills;
    },

    getPromptSections(): PromptSection[] {
      return connections.map((conn) => ({
        name: conn.name,
        content: `MCP Server "${conn.name}" provides: ${conn.tools.map((t) => t.name).join(", ")}`,
      }));
    },

    getTools(): Tool[] {
      return allTools;
    },

    getMCPConnections(): MCPConnection[] {
      return connections.map((c) => c.mcpConnection);
    },

    async install(_source: string): Promise<void> {
      // Not implemented for MCP client — MCP servers are configured via config
    },
  };
}
