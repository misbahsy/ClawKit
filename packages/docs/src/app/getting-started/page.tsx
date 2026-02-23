export default function GettingStartedPage() {
  return (
    <div style={{ maxWidth: "800px" }}>
      <h1>Getting Started</h1>

      <section style={{ marginTop: "2rem" }}>
        <h2>1. Create a new project</h2>
        <pre style={{ background: "#1a1a1a", padding: "1rem", borderRadius: "8px" }}>
          <code>npx clawkit init my-agent</code>
        </pre>
        <p style={{ color: "#888" }}>This scaffolds a new project with default components: CLI channel, Anthropic agent, SQLite memory, and essential tools.</p>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>2. Add components</h2>
        <pre style={{ background: "#1a1a1a", padding: "1rem", borderRadius: "8px" }}>
          <code>{`npx clawkit add telegram\nnpx clawkit add memory-postgres\nnpx clawkit add tool-git tool-web-fetch`}</code>
        </pre>
        <p style={{ color: "#888" }}>Add any components from the registry. Dependencies are automatically installed.</p>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>3. Configure</h2>
        <p style={{ color: "#888" }}>Edit <code>clawkit.config.ts</code> with your API keys and settings. Edit workspace files (AGENTS.md, SOUL.md) to customize your agent's personality.</p>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>4. Run</h2>
        <pre style={{ background: "#1a1a1a", padding: "1rem", borderRadius: "8px" }}>
          <code>npx tsx src/index.ts</code>
        </pre>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>5. List available components</h2>
        <pre style={{ background: "#1a1a1a", padding: "1rem", borderRadius: "8px" }}>
          <code>{`npx clawkit list          # all components\nnpx clawkit list agents   # filter by category\nnpx clawkit status        # show installed components`}</code>
        </pre>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Architecture</h2>
        <p style={{ color: "#888" }}>ClawKit uses 10 component categories. Each category has a TypeScript interface that all implementations must satisfy:</p>
        <ul style={{ color: "#888", lineHeight: 2 }}>
          <li><strong>Channels</strong> — Messaging platforms (CLI, Telegram, Slack, etc.)</li>
          <li><strong>Agents</strong> — LLM runtimes (Anthropic, OpenAI, Ollama, etc.)</li>
          <li><strong>Memory</strong> — Conversation persistence and search</li>
          <li><strong>Tools</strong> — Capabilities the agent can use</li>
          <li><strong>Queue</strong> — Message processing and concurrency</li>
          <li><strong>Prompt</strong> — System prompt assembly</li>
          <li><strong>Sandbox</strong> — Command execution isolation</li>
          <li><strong>Scheduler</strong> — Cron jobs and timed tasks</li>
          <li><strong>Skills</strong> — External skill loading (MCP, markdown, bundles)</li>
          <li><strong>IPC</strong> — Inter-process communication</li>
        </ul>
      </section>
    </div>
  );
}
