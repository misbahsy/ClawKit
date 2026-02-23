import type { Tool, ToolContext, ToolResult } from "clawkit:types";

export interface ScreenshotToolConfig {
  defaultWidth?: number;
  defaultHeight?: number;
  timeout?: number;
}

export default function createScreenshotTool(config: ScreenshotToolConfig): Tool {
  const defaultWidth = config.defaultWidth ?? 1280;
  const defaultHeight = config.defaultHeight ?? 720;
  const timeout = config.timeout ?? 30000;

  return {
    name: "screenshot",
    description:
      "Take a screenshot of a web page. Returns the image as a base64-encoded media attachment.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to screenshot",
        },
        width: {
          type: "number",
          description: "Viewport width in pixels (default 1280)",
        },
        height: {
          type: "number",
          description: "Viewport height in pixels (default 720)",
        },
        fullPage: {
          type: "boolean",
          description: "Capture full scrollable page (default false)",
        },
      },
      required: ["url"],
    },

    async execute(
      args: { url: string; width?: number; height?: number; fullPage?: boolean },
      _context: ToolContext,
    ): Promise<ToolResult> {
      let browser;

      try {
        const puppeteer = await import("puppeteer");
        browser = await puppeteer.default.launch({
          headless: "shell",
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });

        const page = await browser.newPage();
        page.setDefaultTimeout(timeout);

        const width = args.width ?? defaultWidth;
        const height = args.height ?? defaultHeight;
        await page.setViewport({ width, height });

        await page.goto(args.url, { waitUntil: "networkidle2", timeout });

        const screenshotBuffer = await page.screenshot({
          fullPage: args.fullPage ?? false,
          type: "png",
        });

        const base64 = Buffer.from(screenshotBuffer).toString("base64");
        const title = await page.title();

        return {
          output: `Screenshot of "${title}" (${args.url}) at ${width}x${height}`,
          media: [
            {
              type: "image",
              buffer: Buffer.from(base64, "base64"),
              mimeType: "image/png",
              filename: "screenshot.png",
            },
          ],
          metadata: { url: args.url, title, width, height, fullPage: args.fullPage ?? false },
        };
      } catch (err: any) {
        return { output: "", error: err.message };
      } finally {
        if (browser) {
          await browser.close().catch(() => {});
        }
      }
    },
  };
}
