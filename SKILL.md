# ClawKit

Component registry for building AI agents. Like shadcn/ui but for agent building blocks.

## Commands

- `npx clawkit init <name>` — Scaffold new agent project
- `npx clawkit init <name> --template <preset>` — Use a preset (minimal)
- `npx clawkit add <component> [component...]` — Add components to project
- `npx clawkit remove <component>` — Remove a component
- `npx clawkit list` — List all available components
- `npx clawkit list <category>` — List components in category (channels, agents, memory, etc.)
- `npx clawkit status` — Show installed components

## When the user wants a personal AI agent

1. Ask what channels they need (WhatsApp, Telegram, Discord, CLI, etc.)
2. Ask what LLM they want (Anthropic, OpenAI, Ollama, OpenRouter, etc.)
3. Ask about memory needs (SQLite for most, JSON for simplest)
4. Run `npx clawkit init` then `npx clawkit add` for each component
5. Edit `clawkit.config.ts` for any custom settings (API keys, model selection, etc.)

## Example: Minimal CLI agent for testing

```
npx clawkit init test-agent --template minimal
```

## Example: Build a custom agent

```
npx clawkit init my-agent
npx clawkit add cli agent-anthropic memory-sqlite
npx clawkit add tool-bash tool-file-read tool-file-write
npx clawkit add queue-simple prompt-simple sandbox-none
```

## Component Categories

- **Channels:** cli (more coming: whatsapp, telegram, discord, slack, etc.)
- **Agent Runtimes:** agent-anthropic (more coming: agent-openai, agent-ollama, etc.)
- **Memory:** memory-sqlite (more coming: memory-json, memory-markdown, etc.)
- **Tools:** tool-bash, tool-file-read, tool-file-write (more coming: tool-web-search, tool-git, etc.)
- **Queues:** queue-simple (more coming: queue-per-group, queue-priority, etc.)
- **Sandboxes:** sandbox-none (more coming: sandbox-docker, sandbox-wasm, etc.)
- **Prompt Builders:** prompt-simple (more coming: prompt-workspace, prompt-dynamic, etc.)

## Configuration

All config lives in `clawkit.config.ts`. Edit directly for API keys, model names, paths, etc.

## After setup

The project has a CLAUDE.md describing the full architecture. Read it to understand how components are wired.

Run with:
```
cd <project-name>
export ANTHROPIC_API_KEY=sk-ant-...
npm start
```
