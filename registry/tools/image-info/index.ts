import type { Tool, ToolContext, ToolResult } from "clawkit:types";

export interface ImageInfoToolConfig {}

export default function createImageInfoTool(_config: ImageInfoToolConfig): Tool {
  return {
    name: "image_info",
    description:
      "Analyze an image file: dimensions, format, color space, channels, and EXIF metadata.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the image file (relative to workspace or absolute)",
        },
      },
      required: ["path"],
    },

    async execute(
      args: { path: string },
      context: ToolContext,
    ): Promise<ToolResult> {
      try {
        const { resolve } = await import("node:path");
        const sharp = (await import("sharp")).default;

        const imagePath = resolve(context.workspaceDir || process.cwd(), args.path);
        const image = sharp(imagePath);
        const metadata = await image.metadata();
        const stats = await image.stats();

        const sections: string[] = [];

        sections.push(`## Image: ${args.path}`);
        sections.push(`Format: ${metadata.format ?? "unknown"}`);
        sections.push(`Dimensions: ${metadata.width}x${metadata.height}`);
        sections.push(`Channels: ${metadata.channels}`);
        sections.push(`Color Space: ${metadata.space ?? "unknown"}`);

        if (metadata.density) {
          sections.push(`DPI: ${metadata.density}`);
        }

        if (metadata.hasAlpha !== undefined) {
          sections.push(`Alpha Channel: ${metadata.hasAlpha ? "yes" : "no"}`);
        }

        if (metadata.orientation) {
          sections.push(`Orientation: ${metadata.orientation}`);
        }

        const sizeKB = metadata.size ? (metadata.size / 1024).toFixed(1) : "unknown";
        sections.push(`File Size: ${sizeKB} KB`);

        sections.push(metadata.exif
          ? `EXIF Data: present (${metadata.exif.length} bytes)`
          : `EXIF Data: none`);

        // Color statistics
        if (stats.channels && stats.channels.length > 0) {
          const channelNames = ["Red", "Green", "Blue", "Alpha"];
          const statLines = stats.channels.map((ch, i) => {
            const name = channelNames[i] ?? `Channel ${i}`;
            return `  ${name}: min=${ch.min}, max=${ch.max}, mean=${ch.mean.toFixed(1)}`;
          });
          sections.push(`\n## Color Stats\n${statLines.join("\n")}`);
        }

        return {
          output: sections.join("\n"),
          metadata: {
            format: metadata.format,
            width: metadata.width,
            height: metadata.height,
            channels: metadata.channels,
            space: metadata.space,
            hasAlpha: metadata.hasAlpha,
            density: metadata.density,
          },
        };
      } catch (err: any) {
        return { output: "", error: err.message };
      }
    },
  };
}
