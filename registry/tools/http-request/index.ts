import type { Tool, ToolContext, ToolResult } from "clawkit:types";

export interface HttpRequestToolConfig {
  timeout?: number;
  maxResponseLength?: number;
}

export default function createHttpRequestTool(config: HttpRequestToolConfig): Tool {
  const timeout = config.timeout ?? 30000;
  const maxResponseLength = config.maxResponseLength ?? 100000;

  return {
    name: "http_request",
    description: "Make an HTTP request. Supports GET, POST, PUT, PATCH, DELETE with headers, body, and auth.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Request URL",
        },
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"],
          description: "HTTP method (default: GET)",
        },
        headers: {
          type: "object",
          description: "Request headers as key-value pairs",
        },
        body: {
          type: "string",
          description: "Request body (string or JSON string)",
        },
        auth: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["bearer", "basic"] },
            token: { type: "string" },
            username: { type: "string" },
            password: { type: "string" },
          },
          description: "Authentication configuration",
        },
      },
      required: ["url"],
    },

    async execute(
      args: {
        url: string;
        method?: string;
        headers?: Record<string, string>;
        body?: string;
        auth?: { type: "bearer" | "basic"; token?: string; username?: string; password?: string };
      },
      _context: ToolContext,
    ): Promise<ToolResult> {
      try {
        const method = args.method ?? "GET";
        const headers: Record<string, string> = { ...args.headers };

        // Apply auth
        if (args.auth) {
          if (args.auth.type === "bearer" && args.auth.token) {
            headers["Authorization"] = `Bearer ${args.auth.token}`;
          } else if (args.auth.type === "basic" && args.auth.username) {
            const encoded = Buffer.from(`${args.auth.username}:${args.auth.password ?? ""}`).toString("base64");
            headers["Authorization"] = `Basic ${encoded}`;
          }
        }

        // Auto-set content-type for body
        if (args.body && !headers["Content-Type"] && !headers["content-type"]) {
          try {
            JSON.parse(args.body);
            headers["Content-Type"] = "application/json";
          } catch {
            // Not JSON, leave as-is
          }
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(args.url, {
          method,
          headers,
          body: method !== "GET" && method !== "HEAD" ? args.body : undefined,
          signal: controller.signal,
        });

        clearTimeout(timer);

        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        const body = await response.text();
        const truncated = body.length > maxResponseLength
          ? body.slice(0, maxResponseLength) + "\n...(truncated)"
          : body;

        return {
          output: truncated,
          metadata: {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
          },
        };
      } catch (err: any) {
        if (err.name === "AbortError") {
          return { output: "", error: `Request timed out after ${timeout}ms` };
        }
        return { output: "", error: err.message };
      }
    },
  };
}
