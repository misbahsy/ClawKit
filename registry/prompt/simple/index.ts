import type { PromptBuilder, PromptContext } from "clawkit:types";

export interface SimplePromptConfig {
  name?: string;
}

export default function createSimplePrompt(_config: SimplePromptConfig): PromptBuilder {
  return {
    name: "prompt-simple",

    async build(context: PromptContext): Promise<string> {
      const sections: string[] = [];

      const agentName = context.agent.name ?? "Assistant";
      sections.push(`You are ${agentName}, a helpful AI assistant.`);

      sections.push(`Current date and time: ${context.dateTime}`);
      sections.push(`Timezone: ${context.timezone}`);

      if (context.channel) {
        sections.push(`Channel: ${context.channel} (${context.sessionType})`);
      }

      if (context.user?.name) {
        sections.push(`User: ${context.user.name}`);
      }

      if (context.tools.length > 0) {
        const toolList = context.tools
          .map((t) => `- ${t.name}: ${t.description}`)
          .join("\n");
        sections.push(`\nAvailable tools:\n${toolList}`);
      }

      if (context.memoryContext) {
        sections.push(`\nRelevant context from memory:\n${context.memoryContext}`);
      }

      if (context.skills.length > 0) {
        for (const skill of context.skills) {
          if (skill.promptSection) {
            sections.push(`\n${skill.promptSection}`);
          }
        }
      }

      return sections.join("\n");
    },
  };
}
