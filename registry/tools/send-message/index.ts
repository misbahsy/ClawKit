import type { Tool, ToolContext, ToolResult } from "clawkit:types";

export interface SendMessageToolConfig {}

export default function createSendMessageTool(_config: SendMessageToolConfig): Tool {
  return {
    name: "send_message",
    description: "Send a message to another channel or session. Routes through the runtime messaging system.",
    parameters: {
      type: "object",
      properties: {
        channel: {
          type: "string",
          description: "Target channel (e.g., 'discord', 'telegram', 'slack', or a custom channel name)",
        },
        to: {
          type: "string",
          description: "Recipient identifier (user ID, channel ID, or session ID)",
        },
        text: {
          type: "string",
          description: "Message text to send",
        },
      },
      required: ["channel", "to", "text"],
    },

    async execute(
      args: { channel: string; to: string; text: string },
      context: ToolContext,
    ): Promise<ToolResult> {
      try {
        if (context.sendMessage) {
          const response = await context.sendMessage(args.channel, {
            action: "send",
            to: args.to,
            text: args.text,
            fromSession: context.sessionId,
          });
          return {
            output: typeof response === "string" ? response : `Message sent to ${args.to} on ${args.channel}`,
            metadata: { channel: args.channel, to: args.to },
          };
        }

        return {
          output: "",
          error: "No messaging runtime available. context.sendMessage is not configured.",
          metadata: {
            intent: "send_message",
            channel: args.channel,
            to: args.to,
            text: args.text,
          },
        };
      } catch (err: any) {
        return { output: "", error: err.message };
      }
    },
  };
}
