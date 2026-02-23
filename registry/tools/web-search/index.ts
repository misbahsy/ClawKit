import type { Tool, ToolContext, ToolResult } from "clawkit:types";

export interface WebSearchToolConfig {
  provider?: "brave" | "tavily" | "serpapi";
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function searchBrave(query: string, apiKey: string): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
  const res = await fetch(url, {
    headers: { "X-Subscription-Token": apiKey, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Brave API error: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return (data.web?.results ?? []).map((r: any) => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
  }));
}

async function searchTavily(query: string, apiKey: string): Promise<SearchResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, max_results: 5 }),
  });
  if (!res.ok) throw new Error(`Tavily API error: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return (data.results ?? []).map((r: any) => ({
    title: r.title,
    url: r.url,
    snippet: r.content,
  }));
}

async function searchSerpApi(query: string, apiKey: string): Promise<SearchResult[]> {
  const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${apiKey}&num=5`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SerpAPI error: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return (data.organic_results ?? []).map((r: any) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet,
  }));
}

function detectProvider(): { provider: "brave" | "tavily" | "serpapi"; apiKey: string } {
  if (process.env.BRAVE_API_KEY) return { provider: "brave", apiKey: process.env.BRAVE_API_KEY };
  if (process.env.TAVILY_API_KEY) return { provider: "tavily", apiKey: process.env.TAVILY_API_KEY };
  if (process.env.SERPAPI_API_KEY) return { provider: "serpapi", apiKey: process.env.SERPAPI_API_KEY };
  throw new Error("No search API key found. Set BRAVE_API_KEY, TAVILY_API_KEY, or SERPAPI_API_KEY.");
}

export default function createWebSearchTool(config: WebSearchToolConfig): Tool {
  return {
    name: "web_search",
    description: "Search the web for current information. Returns titles, URLs, and snippets.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query",
        },
      },
      required: ["query"],
    },

    async execute(args: { query: string }, _context: ToolContext): Promise<ToolResult> {
      try {
        const { provider, apiKey } = detectProvider();
        let results: SearchResult[];

        switch (provider) {
          case "brave":
            results = await searchBrave(args.query, apiKey);
            break;
          case "tavily":
            results = await searchTavily(args.query, apiKey);
            break;
          case "serpapi":
            results = await searchSerpApi(args.query, apiKey);
            break;
        }

        if (results.length === 0) {
          return { output: "No results found." };
        }

        const formatted = results
          .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
          .join("\n\n");

        return { output: formatted };
      } catch (err: any) {
        return { output: "", error: err.message };
      }
    },
  };
}
