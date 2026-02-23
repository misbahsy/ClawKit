import type { Tool, ToolContext, ToolResult } from "clawkit:types";

export interface BrowserToolConfig {
  headless?: boolean;
  timeout?: number;
}

export default function createBrowserTool(config: BrowserToolConfig): Tool {
  const headless = config.headless ?? true;
  const timeout = config.timeout ?? 30000;

  return {
    name: "browser",
    description:
      "Full browser automation. Navigate to URLs, click elements, type text, take screenshots, and evaluate JavaScript via Chrome DevTools Protocol.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to navigate to (required for 'navigate' action)",
        },
        action: {
          type: "string",
          enum: ["navigate", "click", "type", "screenshot", "evaluate"],
          description: "The browser action to perform",
        },
        selector: {
          type: "string",
          description: "CSS selector for click/type actions",
        },
        text: {
          type: "string",
          description: "Text to type (for 'type' action)",
        },
        script: {
          type: "string",
          description: "JavaScript to evaluate in page context (for 'evaluate' action)",
        },
      },
      required: ["action"],
    },

    async execute(
      args: {
        url?: string;
        action: "navigate" | "click" | "type" | "screenshot" | "evaluate";
        selector?: string;
        text?: string;
        script?: string;
      },
      _context: ToolContext,
    ): Promise<ToolResult> {
      let browser;
      let page;

      try {
        const puppeteer = await import("puppeteer");
        browser = await puppeteer.default.launch({
          headless: headless ? "shell" : false,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
        page = await browser.newPage();
        page.setDefaultTimeout(timeout);

        switch (args.action) {
          case "navigate": {
            if (!args.url) {
              return { output: "", error: "URL is required for navigate action" };
            }
            await page.goto(args.url, { waitUntil: "domcontentloaded", timeout });
            const title = await page.title();
            const content = await page.evaluate(() => document.body?.innerText?.slice(0, 10000) ?? "");
            return {
              output: `Navigated to: ${args.url}\nTitle: ${title}\n\n${content}`,
              metadata: { url: args.url, title },
            };
          }

          case "click": {
            if (!args.selector) {
              return { output: "", error: "Selector is required for click action" };
            }
            if (args.url) {
              await page.goto(args.url, { waitUntil: "domcontentloaded", timeout });
            }
            await page.click(args.selector);
            await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
            const content = await page.evaluate(() => document.body?.innerText?.slice(0, 10000) ?? "");
            return { output: `Clicked: ${args.selector}\n\n${content}` };
          }

          case "type": {
            if (!args.selector) {
              return { output: "", error: "Selector is required for type action" };
            }
            if (!args.text) {
              return { output: "", error: "Text is required for type action" };
            }
            if (args.url) {
              await page.goto(args.url, { waitUntil: "domcontentloaded", timeout });
            }
            await page.type(args.selector, args.text);
            return { output: `Typed "${args.text}" into ${args.selector}` };
          }

          case "screenshot": {
            if (args.url) {
              await page.goto(args.url, { waitUntil: "domcontentloaded", timeout });
            }
            const screenshot = await page.screenshot({ encoding: "base64", fullPage: true });
            return {
              output: "Screenshot captured",
              media: [
                {
                  type: "image",
                  buffer: Buffer.from(screenshot as string, "base64"),
                  mimeType: "image/png",
                  filename: "screenshot.png",
                },
              ],
            };
          }

          case "evaluate": {
            if (!args.script) {
              return { output: "", error: "Script is required for evaluate action" };
            }
            if (args.url) {
              await page.goto(args.url, { waitUntil: "domcontentloaded", timeout });
            }
            const result = await page.evaluate(args.script);
            const output =
              typeof result === "string" ? result : JSON.stringify(result, null, 2);
            return { output };
          }

          default:
            return { output: "", error: `Unknown action: ${args.action}` };
        }
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
