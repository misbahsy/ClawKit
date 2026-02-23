import type { PromptBuilder, PromptContext } from "clawkit:types";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface IdentityFileConfig {
  name?: string;
  identityFile?: string;
}

interface IdentityJson {
  name?: string;
  personality?: string;
  traits?: string[];
  communicationStyle?: string;
  moralAlignment?: string;
  instructions?: string;
}

export default function createIdentityFilePrompt(config: IdentityFileConfig): PromptBuilder {
  let cachedIdentity: string | null = null;
  let cachedPath: string | null = null;

  function loadIdentity(filePath: string): string | null {
    const resolved = resolve(filePath);

    if (!existsSync(resolved)) {
      return null;
    }

    const content = readFileSync(resolved, "utf-8").trim();

    if (resolved.endsWith(".json")) {
      try {
        const data: IdentityJson = JSON.parse(content);
        const sections: string[] = [];

        if (data.name) {
          sections.push(`You are ${data.name}.`);
        }

        if (data.personality) {
          sections.push(`Personality: ${data.personality}`);
        }

        if (data.traits && data.traits.length > 0) {
          sections.push(`Traits: ${data.traits.join(", ")}`);
        }

        if (data.communicationStyle) {
          sections.push(`Communication style: ${data.communicationStyle}`);
        }

        if (data.moralAlignment) {
          sections.push(`Moral alignment: ${data.moralAlignment}`);
        }

        if (data.instructions) {
          sections.push(`\n${data.instructions}`);
        }

        return sections.join("\n");
      } catch {
        return null;
      }
    }

    // .md or any other extension: return content as-is
    return content;
  }

  return {
    name: "prompt-identity-file",

    async build(context: PromptContext): Promise<string> {
      const sections: string[] = [];

      // Load identity from file
      const identityPath = config.identityFile;
      if (identityPath) {
        // Cache identity content for same path
        if (cachedPath !== identityPath) {
          cachedIdentity = loadIdentity(identityPath);
          cachedPath = identityPath;
        }

        if (cachedIdentity) {
          sections.push(cachedIdentity);
        }
      }

      // Fallback to context identity if no file or file not found
      if (sections.length === 0) {
        const agentName = context.agent.name ?? "Assistant";
        sections.push(`You are ${agentName}.`);

        if (context.agent.personality) {
          sections.push(`Personality: ${context.agent.personality}`);
        }
      }

      // Runtime context
      sections.push(`\nCurrent date and time: ${context.dateTime}`);
      sections.push(`Timezone: ${context.timezone}`);

      if (context.channel) {
        sections.push(`Channel: ${context.channel} (${context.sessionType})`);
      }

      if (context.user?.name) {
        sections.push(`User: ${context.user.name}`);
      }

      // Available tools
      if (context.tools.length > 0) {
        const toolList = context.tools
          .map((t) => `- ${t.name}: ${t.description}`)
          .join("\n");
        sections.push(`\nAvailable tools:\n${toolList}`);
      }

      // Memory context
      if (context.memoryContext) {
        sections.push(`\nRelevant context from memory:\n${context.memoryContext}`);
      }

      // Skills
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
