# ClawKit

A composable framework for building AI agents. Pick an LLM, wire up tools, plug in memory, and ship.

ClawKit treats AI agents like LEGO — every piece (model runtime, memory backend, tools, channels, queues) is a swappable component. Mix and match 104 components across 10 categories to build anything from a one-file CLI bot to a multi-channel enterprise agent.

```
npm install -g clawkit
clawkit init my-agent --template minimal
cd my-agent && npm start
```

---

## Why ClawKit

Most agent frameworks lock you into one LLM provider, one way of doing memory, one deployment model. ClawKit doesn't.

- **Swap any piece** — switch from OpenAI to Ollama by changing one component, not rewriting your agent
- **10 presets** — from zero-key local agents to full-stack setups with 17 tools
- **104 components** — agents, channels, memory, tools, queues, schedulers, sandboxes, skills, IPC
- **No vendor lock-in** — every component implements a shared interface
- **Build small** — a nano-bot is ~20 lines of config. A full agent is the same architecture, just more components

---

## Quick Start

### 1. Scaffold a project

```bash
# Anthropic-powered agent (needs ANTHROPIC_API_KEY)
clawkit init my-agent

# Fully local with Ollama (no API keys)
clawkit init my-agent --template local-ollama

# OpenAI with extended dev tools
clawkit init my-agent --template openai-full
```

### 2. Set your key

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### 3. Run it

```bash
cd my-agent
npm start
```

You now have a working agent with CLI interface, SQLite memory, and shell/file tools.

---

## Building Agents

### The Nano Bot

The smallest useful agent. CLI in, CLI out, remembers conversations.

```bash
clawkit init nano --template minimal
```

This gives you:

| Component | What it does |
|-----------|-------------|
| `agent-anthropic` | Claude as the brain |
| `cli` | Terminal REPL interface |
| `memory-sqlite` | Persists conversations to local SQLite |
| `queue-simple` | Processes messages in order |
| `prompt-simple` | Basic system prompt |
| `sandbox-none` | No sandboxing (direct execution) |
| `tool-bash` | Run shell commands |
| `tool-file-read` | Read files |
| `tool-file-write` | Write files |

Edit `workspace/AGENTS.md` to give it a personality:

```markdown
# Agent Identity

You are nano, a minimal coding assistant.
You help with quick shell tasks and file edits.
Keep responses under 3 sentences unless asked for more.
```

### The Local Bot (No API Keys)

```bash
clawkit init local-bot --template local-ollama
```

Uses Ollama running on your machine. No data leaves localhost. Just run `ollama serve` first.

### The Coding Agent

```bash
clawkit init coder --template deepseek-coder
```

DeepSeek optimized for code, with file editing, git, and search tools. Or use OpenAI:

```bash
clawkit init coder --template openai-full
```

This adds `tool-file-edit`, `tool-git`, `tool-web-fetch`, and `tool-web-search` on top of the basics.

### The Full Agent

```bash
clawkit init beast --template full-stack
```

All 17 tools, hybrid memory (keyword + vector search with RRF fusion), and Claude. This is the kitchen sink — browser automation, screenshots, sub-agent spawning, delegation, scheduling, the works.

### The HTTP API Agent

```bash
clawkit init api-bot --template webhook-api
```

Exposes your agent as an HTTP endpoint. POST messages, GET responses. Useful for integrating with other systems:

```bash
curl -X POST http://localhost:3000/message \
  -H "Content-Type: application/json" \
  -d '{"sender": "api-user", "content": "summarize this repo"}'
```

---

## How It Works

```
Input --> Channel --> Queue --> Prompt Builder --> Agent (LLM)
                                   |                  |
                              Memory Search      Tool Calls
                                   |                  |
                              Context Injection   Tool Executor
                                                      |
                                                  Response
                                                      |
                                            Save to Memory
                                                      |
                                            Send via Channel
```

Every box in that diagram is a replaceable component. The runtime (`startAgent`) wires them together:

1. **Channel** receives a message (CLI input, webhook POST, WebSocket, etc.)
2. **Queue** orders it (simple FIFO, priority, per-group, steering)
3. **Memory** loads conversation history + searches for relevant context
4. **Prompt Builder** assembles the system prompt (identity, tools, context)
5. **Agent** sends to the LLM, streams events back
6. **Tool Executor** handles any tool calls the LLM makes
7. **Memory** saves the exchange
8. **Channel** delivers the response

---

## Presets

| Preset | Agent | Memory | Tools | API Key |
|--------|-------|--------|-------|---------|
| `minimal` | Anthropic Claude | SQLite | bash, file-read, file-write | `ANTHROPIC_API_KEY` |
| `local-ollama` | Ollama (local) | SQLite | bash, file-read, file-write, web-search | None |
| `openai-full` | OpenAI GPT | SQLite | 7 tools (dev + web) | `OPENAI_API_KEY` |
| `gemini-starter` | Google Gemini | JSON | bash, file-read, file-write | `GOOGLE_API_KEY` |
| `deepseek-coder` | DeepSeek | SQLite | 6 tools (dev + search) | `DEEPSEEK_API_KEY` |
| `openrouter-multi` | OpenRouter | SQLite | bash, file-read, file-write, web-search | `OPENROUTER_API_KEY` |
| `enterprise-aws` | AWS Bedrock | PostgreSQL | bash, file-read, file-write, web-search | `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` |
| `webchat-demo` | Anthropic Claude | SQLite | bash, file-read, file-write | `ANTHROPIC_API_KEY` |
| `webhook-api` | Anthropic Claude | SQLite | bash, file-read, file-write, http-request | `ANTHROPIC_API_KEY` |
| `full-stack` | Anthropic Claude | Hybrid RRF | All 17 tools | `ANTHROPIC_API_KEY` |

---

## Components

### Agents (11)

The LLM runtime. Each agent implements the same `AgentRuntime` interface — async generator that yields streaming events.

| Agent | Provider | Default Model | Notes |
|-------|----------|---------------|-------|
| `agent-anthropic` | Anthropic | claude-sonnet-4-20250514 | Streaming, prompt caching, tool loop |
| `agent-openai` | OpenAI | gpt-4o | Function calling, streaming |
| `agent-ollama` | Ollama (local) | llama3.2 | No API key, runs on localhost |
| `agent-gemini` | Google | gemini-pro | Long context window |
| `agent-deepseek` | DeepSeek | deepseek-chat | Code-optimized, cheap |
| `agent-openrouter` | OpenRouter | anthropic/claude-sonnet-4-20250514 | 100+ models via one API |
| `agent-bedrock` | AWS | claude-3-sonnet | IAM auth, enterprise |
| `agent-claude-sdk` | Anthropic SDK | claude-sonnet-4-20250514 | Highest capability, agentic |
| `agent-generic-openai` | Any OpenAI-compatible | gpt-4o | Custom baseUrl, works with LM Studio, vLLM, etc. |
| `agent-pi-embedded` | Local | — | Embedded/edge devices |
| `agent-codex-sdk` | OpenAI Codex | — | Code generation |

### Memory (11)

How your agent remembers. Every memory backend supports `save`, `load`, `search`, and `compact`.

| Memory | Storage | Search | Best For |
|--------|---------|--------|----------|
| `memory-sqlite` | Local SQLite file | FTS5 keyword | Default — fast, zero config |
| `memory-json` | JSON files | Basic | Simple bots, debugging |
| `memory-markdown` | Markdown files | Basic | Human-readable logs |
| `memory-postgres` | PostgreSQL | Full-text | Multi-instance, production |
| `memory-hybrid-rrf` | SQLite + embeddings | Keyword + vector (RRF fusion) | Best recall, needs Ollama for embeddings |
| `memory-sqlite-hybrid` | SQLite | Keyword + semantic | Good middle ground |
| `memory-vector` | Vector DB | Pure semantic | Similarity search |
| `memory-knowledge-graph` | Graph structure | Graph traversal | Structured knowledge |
| `memory-qmd` | QMD format | Metadata-aware | Advanced metadata |
| `memory-lucid` | Custom | Adaptive | Research |
| `memory-none` | Nothing | None | Stateless bots |

### Tools (22)

What your agent can do. Each tool has a name, description, JSON schema parameters, and an `execute` function.

**File & Code:**
`tool-bash` `tool-file-read` `tool-file-write` `tool-file-edit` `tool-file-search` `tool-git`

**Web & Network:**
`tool-web-search` `tool-web-fetch` `tool-http-request` `tool-browser` `tool-screenshot`

**Agent Operations:**
`tool-memory-read` `tool-memory-write` `tool-send-message` `tool-spawn-agent` `tool-delegate` `tool-cron`

**Specialized:**
`tool-qmd-search` `tool-pushover` `tool-hardware` `tool-image-info` `tool-composio`

### Channels (20)

How users talk to your agent.

**Local:** `cli` `webchat` `webhook`

**Chat platforms:** `telegram` `discord` `slack` `whatsapp` `signal` `imessage` `sms`

**Enterprise:** `teams` `google-chat` `mattermost` `matrix` `email`

**Regional:** `lark` `dingtalk` `qq` `zalo` `irc`

### Queue (6)

Message processing order: `queue-simple` (FIFO), `queue-per-group` (per-session concurrency), `queue-priority`, `queue-steer` (route to different handlers), `queue-collect` (batch), `queue-persistent` (survives restarts).

### Prompt Builders (5)

System prompt assembly: `prompt-simple`, `prompt-workspace` (reads AGENTS.md/SOUL.md/TOOLS.md/USER.md), `prompt-dynamic`, `prompt-security-aware`, `prompt-identity-file`.

### Sandboxes (9)

Code execution safety: `sandbox-none`, `sandbox-docker`, `sandbox-workspace-scoped`, `sandbox-wasm`, `sandbox-apple-container`, `sandbox-docker-orchestrator`, `sandbox-nsjail`, `sandbox-firecracker`, `sandbox-landlock`.

### Schedulers (6)

Time-based jobs: `scheduler-cron`, `scheduler-simple`, `scheduler-heartbeat`, `scheduler-persistent`, `scheduler-webhook`, `scheduler-event`.

### IPC (8)

Inter-process communication: `ipc-filesystem`, `ipc-websocket`, `ipc-stdio`, `ipc-http`, `ipc-sse`, `ipc-grpc`, `ipc-unix-socket`, `ipc-mcp-transport`.

### Skills (5)

External integrations: `skills-mcp-client` (Model Context Protocol servers), `skills-markdown`, `skills-clawhub`, `skills-tool-bundle`, `skills-dynamic`.

---

## Adding & Removing Components

```bash
# Add a component
clawkit add tool-git tool-web-search

# Remove one
clawkit remove tool-web-search

# See what's available
clawkit list
clawkit list agents
clawkit list tools

# See what's installed
clawkit status
```

---

## Project Structure

After `clawkit init`, your project looks like:

```
my-agent/
  src/
    index.ts          # Entry point — wires everything together
  components/
    agents/anthropic/  # Your agent runtime
    channels/cli/      # Your channel
    memory/sqlite/     # Your memory backend
    tools/bash/        # Each tool
    ...
  workspace/
    AGENTS.md          # Agent identity & personality
    SOUL.md            # Behavioral guidelines
    TOOLS.md           # Tool usage instructions
    USER.md            # User profile
  data/                # Runtime data (SQLite DB, etc.)
  clawkit.config.ts    # Component configuration
  package.json
  tsconfig.json
  .env.example
```

### Configuration

`clawkit.config.ts` controls everything:

```typescript
import { defineConfig } from "./core/config.js";

export default defineConfig({
  name: "my-agent",
  typescript: true,
  aliases: {
    components: "./components",
    workspace: "./workspace",
  },
  agent: {
    name: "agent-anthropic",
    model: "claude-sonnet-4-20250514",
    maxTokens: 16384,
  },
  memory: {
    name: "memory-sqlite",
    dbPath: "./data/memory.db",
  },
  tools: [
    "tool-bash",
    "tool-file-read",
    "tool-file-write",
  ],
});
```

### Workspace Files

The `workspace/` directory shapes your agent's behavior:

- **AGENTS.md** — Who the agent is. Name, role, expertise.
- **SOUL.md** — How it behaves. Tone, boundaries, style.
- **TOOLS.md** — When and how to use tools.
- **USER.md** — Info about the user (filled in over time or manually).

---

## Agent Interfaces

### AgentRuntime

Every agent implements this. The `run()` method is an async generator that yields events:

```typescript
interface AgentRuntime {
  name: string;
  run(params: {
    systemPrompt: string;
    messages: Message[];
    tools: ToolDefinition[];
    toolExecutor: (name: string, input: any) => Promise<ToolResult>;
    onEvent: (event: AgentEvent) => void;
  }): AsyncIterable<AgentEvent>;
  abort(): void;
}
```

Events: `text_delta` (streaming chunk), `text_done` (full response), `tool_use` (agent called a tool), `tool_result` (tool returned), `error`, `done` (with token usage).

### Memory

```typescript
interface Memory {
  name: string;
  init(): Promise<void>;
  saveMessages(sessionId: string, messages: Message[]): Promise<void>;
  loadMessages(sessionId: string, limit?: number): Promise<Message[]>;
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  compact(sessionId: string): Promise<void>;
  clear(sessionId: string): Promise<void>;
}
```

### Tool

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: Record<string, any>; // JSON Schema
  execute(args: Record<string, any>, context: ToolContext): Promise<ToolResult>;
}
```

### Channel

```typescript
interface Channel {
  name: string;
  connect(): Promise<void>;
  onMessage(callback: (msg: IncomingMessage) => void): void;
  sendMessage(to: string, content: MessageContent): Promise<void>;
  sendMedia(to: string, media: MediaContent): Promise<void>;
  disconnect(): Promise<void>;
}
```

---

## Writing Custom Components

### Custom Tool

Create a new tool with the CLI:

```bash
clawkit create-component my-tool --category tools
```

Then implement it in `registry/tools/my-tool/index.ts`:

```typescript
import type { Tool } from "clawkit:types";

export default function createMyTool(config: { apiKey?: string }): Tool {
  return {
    name: "tool-my-tool",
    description: "Does something useful",
    parameters: {
      type: "object",
      properties: {
        input: { type: "string", description: "The input to process" },
      },
      required: ["input"],
    },
    async execute(args, context) {
      const result = await doSomething(args.input);
      return { output: result };
    },
  };
}
```

### Custom Agent

Wrap any LLM API:

```typescript
import type { AgentRuntime, AgentEvent } from "clawkit:types";

export default function createMyAgent(config: { apiKey: string }): AgentRuntime {
  return {
    name: "agent-my-llm",
    async *run(params): AsyncGenerator<AgentEvent> {
      const response = await callMyLLM({
        system: params.systemPrompt,
        messages: params.messages,
        tools: params.tools,
      });

      yield { type: "text_delta", text: response.text };
      yield { type: "text_done", text: response.text };
      yield { type: "done", usage: { inputTokens: response.input, outputTokens: response.output } };
    },
    abort() {},
  };
}
```

### Custom Memory

```typescript
import type { Memory } from "clawkit:types";

export default function createMyMemory(config: {}): Memory {
  const store = new Map();
  return {
    name: "memory-custom",
    async init() {},
    async saveMessages(sessionId, messages) { /* ... */ },
    async loadMessages(sessionId) { /* ... */ },
    async search(query) { /* ... */ },
    async compact(sessionId) { /* ... */ },
    async clear(sessionId) { store.delete(sessionId); },
  };
}
```

---

## Testing

```bash
# Unit tests (1001 tests)
npm test

# Smoke tests — preset wiring, no API keys needed
npm run test:smoke

# Agent API tests — needs keys in env, skips gracefully
npm run test:agents

# Channel connectivity — webhook, webchat, IPC (local only)
npm run test:channels

# Everything
npm run test:all
```

Set up API keys for agent smoke tests by copying `.env.test.example`:

```bash
cp .env.test.example .env.test
# Edit .env.test with your keys
```

---

## Monorepo Structure

```
clawkit/
  packages/
    core/          # Runtime, types, config
    cli/           # CLI tool (init, add, remove, list, status)
  registry/        # All 104 components
    agents/        # 11 LLM runtimes
    channels/      # 20 communication interfaces
    memory/        # 11 storage backends
    tools/         # 22 agent tools
    queue/         # 6 message queues
    prompt/        # 5 prompt builders
    sandbox/       # 9 execution sandboxes
    scheduler/     # 6 job schedulers
    skills/        # 5 skill integrations
    ipc/           # 8 IPC transports
  tests/
    core/          # Runtime tests
    cli/           # Scaffolding tests
    components/    # Component unit tests
    smoke/         # Integration & connectivity tests
```

---

## License

MIT
