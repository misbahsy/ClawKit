import type {
  Channel, AgentRuntime, Memory, Queue, PromptBuilder, Scheduler,
  Sandbox, Tool, SkillsManager, IPC, IncomingMessage, Message,
  ToolDefinition, ClawKitConfig, ToolResult,
} from "./types.js";

export interface ClawKitComponents {
  channels: Channel[];
  agent: AgentRuntime;
  memory: Memory;
  queue: Queue;
  promptBuilder: PromptBuilder;
  scheduler?: Scheduler;
  sandbox?: Sandbox;
  tools: Tool[];
  skills?: SkillsManager;
  ipc?: IPC;
  config: ClawKitConfig;
}

export async function startAgent(components: ClawKitComponents): Promise<void> {
  const { channels, agent, memory, queue, promptBuilder, tools, skills, config } = components;

  await memory.init();

  const loadedSkills = skills ? await skills.loadSkills(config.skills ?? {}) : [];
  const skillTools = skills ? skills.getTools() : [];
  const allTools = [...tools, ...skillTools];

  const toolDefs: ToolDefinition[] = allTools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));

  const toolExecutor = async (name: string, input: any): Promise<ToolResult> => {
    const tool = allTools.find(t => t.name === name);
    if (!tool) return { output: "", error: `Unknown tool: ${name}` };
    try {
      return await tool.execute(input, {
        workspaceDir: config.aliases.workspace,
        sessionId: "system",
        sandbox: components.sandbox,
        agent,
        sendMessage: async (ch: string, to: string, text: string) => {
          const channel = channels.find(c => c.name === ch) ?? channels[0];
          await channel.sendMessage(to, { text });
        },
      });
    } catch (err: any) {
      return { output: "", error: err.message };
    }
  };

  async function handleMessage(msg: IncomingMessage): Promise<void> {
    const sessionId = msg.group ?? msg.sender;
    const history = await memory.loadMessages(sessionId, 50);
    const memoryResults = msg.content ? await memory.search(msg.content, { limit: 3 }) : [];
    const memoryContext = memoryResults.map(r => r.content).join("\n\n");

    const systemPrompt = await promptBuilder.build({
      agent: { name: config.name },
      dateTime: new Date().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      channel: msg.channel,
      sessionType: msg.group ? "group" : "dm",
      group: msg.group ? { name: msg.groupName ?? msg.group, memberCount: 0 } : undefined,
      tools: toolDefs,
      skills: loadedSkills,
      memoryContext: memoryContext || undefined,
      user: { name: msg.senderName ?? msg.sender },
      mode: "full",
    });

    const userMsg: Message = { role: "user", content: msg.content, timestamp: new Date() };
    const messages = [...history, userMsg];

    let fullResponse = "";

    for await (const event of agent.run({ systemPrompt, messages, tools: toolDefs, toolExecutor })) {
      switch (event.type) {
        case "text_done":
          fullResponse = event.text;
          break;
        case "error":
          console.error(`Agent error: ${event.error.message}`);
          fullResponse = "Sorry, I encountered an error. Please try again.";
          break;
        case "done":
          if (event.usage) {
            console.log(`Tokens: ${event.usage.inputTokens} in / ${event.usage.outputTokens} out`);
          }
          break;
      }
    }

    if (fullResponse) {
      const sourceChannel = channels.find(c => c.name === msg.channel) ?? channels[0];
      const replyTo = msg.group ?? msg.sender;
      await sourceChannel.sendMessage(replyTo, { text: fullResponse });
    }

    const assistantMsg: Message = { role: "assistant", content: fullResponse, timestamp: new Date() };
    await memory.saveMessages(sessionId, [userMsg, assistantMsg]);
  }

  queue.process(async (queued) => {
    await handleMessage(queued.message);
  });

  for (const channel of channels) {
    channel.onMessage((msg) => {
      queue.enqueue(msg.group ?? msg.sender, {
        id: msg.id,
        sessionId: msg.group ?? msg.sender,
        message: msg,
        enqueuedAt: new Date(),
      });
    });
  }

  for (const channel of channels) {
    await channel.connect({});
    console.log(`Channel connected: ${channel.name}`);
  }

  if (components.scheduler) {
    await components.scheduler.start();
    console.log("Scheduler started");
  }

  if (components.ipc) {
    await components.ipc.start();
    console.log("IPC started");
  }

  console.log(`\n${config.name} is running!\n`);
}
