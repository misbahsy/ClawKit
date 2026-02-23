import type { Tool, ToolContext, ToolResult } from "clawkit:types";

export interface WebFetchToolConfig {
  timeout?: number;
  maxLength?: number;
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " ",
};

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39);/g, (m) => HTML_ENTITIES[m] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

function extractBySelector(html: string, selector: string): string {
  // Simple ID and class selector extraction
  let pattern: RegExp;
  if (selector.startsWith("#")) {
    const id = selector.slice(1);
    pattern = new RegExp(`<[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)(?=<\\/[a-z])`, "i");
  } else if (selector.startsWith(".")) {
    const cls = selector.slice(1);
    pattern = new RegExp(`<[^>]+class=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>([\\s\\S]*?)(?=<\\/[a-z])`, "i");
  } else {
    // Tag selector
    pattern = new RegExp(`<${selector}[^>]*>([\\s\\S]*?)<\\/${selector}>`, "gi");
  }

  const matches = html.match(pattern);
  if (matches) {
    return matches.map((m) => stripHtml(m)).join("\n\n");
  }
  return "";
}

export default function createWebFetchTool(config: WebFetchToolConfig): Tool {
  const timeout = config.timeout ?? 15000;
  const maxLength = config.maxLength ?? 50000;

  return {
    name: "web_fetch",
    description: "Fetch a web page and return its text content. Strips HTML tags. Optional CSS selector filtering.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to fetch",
        },
        selector: {
          type: "string",
          description: "Optional CSS selector to filter content (supports #id, .class, or tag)",
        },
      },
      required: ["url"],
    },

    async execute(args: { url: string; selector?: string }, _context: ToolContext): Promise<ToolResult> {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(args.url, {
          signal: controller.signal,
          headers: {
            "User-Agent": "ClawKit-WebFetch/1.0",
            Accept: "text/html,application/xhtml+xml,text/plain,application/json",
          },
        });

        clearTimeout(timer);

        if (!response.ok) {
          return { output: "", error: `HTTP ${response.status} ${response.statusText}` };
        }

        const contentType = response.headers.get("content-type") ?? "";
        const body = await response.text();

        // If JSON, return as-is
        if (contentType.includes("application/json")) {
          const truncated = body.length > maxLength ? body.slice(0, maxLength) + "\n...(truncated)" : body;
          return { output: truncated, metadata: { contentType, length: body.length } };
        }

        // HTML: extract or strip
        let text: string;
        if (args.selector) {
          text = extractBySelector(body, args.selector);
          if (!text) {
            text = stripHtml(body);
            return { output: text.slice(0, maxLength), metadata: { contentType, selectorMatch: false } };
          }
        } else {
          text = stripHtml(body);
        }

        const truncated = text.length > maxLength ? text.slice(0, maxLength) + "\n...(truncated)" : text;
        return { output: truncated, metadata: { contentType, length: body.length } };
      } catch (err: any) {
        if (err.name === "AbortError") {
          return { output: "", error: `Request timed out after ${timeout}ms` };
        }
        return { output: "", error: err.message };
      }
    },
  };
}
