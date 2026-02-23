import type { PromptBuilder, PromptContext, PromptSection } from "clawkit:types";

export interface DynamicPromptConfig {
  maxTokenEstimate?: number;
  defaultMode?: "full" | "minimal" | "none";
}

export default function createDynamicPrompt(config: DynamicPromptConfig): PromptBuilder {
  const maxTokens = config.maxTokenEstimate ?? 4000;
  const defaultMode = config.defaultMode ?? "full";

  function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  function pruneToolDescriptions(tools: Array<{ name: string; description: string }>, topic: string): string {
    if (!topic || tools.length === 0) return "";
    // Score tools by relevance to topic
    const topicWords = topic.toLowerCase().split(/\s+/);
    const scored = tools.map(t => {
      const desc = (t.name + " " + t.description).toLowerCase();
      const score = topicWords.filter(w => desc.includes(w)).length;
      return { ...t, score };
    });
    scored.sort((a, b) => b.score - a.score);
    // Show relevant tools in full, others as name-only
    const relevant = scored.filter(s => s.score > 0);
    const others = scored.filter(s => s.score === 0);
    const parts: string[] = [];
    for (const t of relevant) {
      parts.push(`- ${t.name}: ${t.description}`);
    }
    if (others.length > 0) {
      parts.push(`Also available: ${others.map(t => t.name).join(", ")}`);
    }
    return parts.join("\n");
  }

  return {
    name: "prompt-dynamic",

    async build(context: PromptContext): Promise<string> {
      const mode = context.mode ?? defaultMode;
      if (mode === "none") return "";

      const sections: Array<{ content: string; priority: number }> = [];

      // Priority 1: Identity (always included)
      const agentName = context.agent.name ?? "Assistant";
      const identity = context.agent.identity
        ? context.agent.identity
        : `You are ${agentName}, a helpful AI assistant.`;
      sections.push({ content: identity, priority: 1 });

      // Priority 2: Date/time context
      sections.push({ content: `Current date: ${context.dateTime} (${context.timezone})`, priority: 2 });

      // Priority 3: Channel context (trimmed for groups in minimal mode)
      if (context.channel) {
        let channelInfo = `Channel: ${context.channel} (${context.sessionType})`;
        if (context.sessionType === "group" && context.group) {
          channelInfo += mode === "full"
            ? `\nGroup: ${context.group.name} (${context.group.memberCount} members)`
            : `\nGroup: ${context.group.name}`;
        }
        sections.push({ content: channelInfo, priority: 3 });
      }

      // Priority 4: User context
      if (context.user?.name) {
        let userInfo = `User: ${context.user.name}`;
        if (mode === "full" && context.user.profile) {
          userInfo += `\n${context.user.profile}`;
        }
        sections.push({ content: userInfo, priority: 4 });
      }

      // Priority 5: Personality
      if (mode === "full" && context.agent.personality) {
        sections.push({ content: context.agent.personality, priority: 5 });
      }

      // Priority 6: Tools (with topic-based pruning)
      if (context.tools.length > 0) {
        const lastUserMsg = ""; // Topic detection from context
        const toolSection = mode === "full"
          ? context.tools.map(t => `- ${t.name}: ${t.description}`).join("\n")
          : pruneToolDescriptions(context.tools, lastUserMsg);
        if (toolSection) {
          sections.push({ content: `Available tools:\n${toolSection}`, priority: 6 });
        }
      }

      // Priority 7: Memory context
      if (context.memoryContext) {
        const memContent = mode === "minimal"
          ? context.memoryContext.slice(0, 500)
          : context.memoryContext;
        sections.push({ content: `Relevant context:\n${memContent}`, priority: 7 });
      }

      // Priority 8: Skills
      if (context.skills.length > 0) {
        for (const skill of context.skills) {
          if (skill.promptSection) {
            sections.push({ content: skill.promptSection, priority: 8 });
          }
        }
      }

      // Priority 9: Workspace files (full mode only)
      if (mode === "full" && context.workspaceFiles) {
        for (const file of context.workspaceFiles) {
          sections.push({ content: `[${file.path}]\n${file.content}`, priority: 9 });
        }
      }

      // Token budget pruning: remove lowest-priority sections if over budget
      sections.sort((a, b) => a.priority - b.priority);
      const result: string[] = [];
      let tokenCount = 0;
      const budget = context.maxTokens ?? maxTokens;

      for (const section of sections) {
        const sectionTokens = estimateTokens(section.content);
        if (tokenCount + sectionTokens > budget && result.length > 0) {
          break; // Stop adding sections once over budget
        }
        result.push(section.content);
        tokenCount += sectionTokens;
      }

      return result.join("\n\n");
    },
  };
}
