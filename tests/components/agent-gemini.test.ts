import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGenerateContentStream = vi.fn();
const mockGetGenerativeModel = vi.fn(() => ({
  generateContentStream: mockGenerateContentStream,
}));

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: vi.fn(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
}));

import createGeminiAgent from "../../registry/agents/gemini/index.js";

function makeSimpleStreamResponse(text: string) {
  const mockStream = (async function* () {
    yield {
      text: () => text,
      candidates: [{
        content: { parts: [{ text }] },
      }],
    };
  })();

  return {
    stream: mockStream,
    response: Promise.resolve({
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    }),
  };
}

async function runAgent(agent: any, overrides?: any) {
  const events: any[] = [];
  for await (const event of agent.run({
    systemPrompt: "test",
    messages: [{ role: "user", content: "test" }],
    tools: [],
    ...overrides,
  })) {
    events.push(event);
  }
  return events;
}

describe("agent-gemini", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have correct agent name", () => {
    const agent = createGeminiAgent({ apiKey: "test-key" });
    expect(agent.name).toBe("agent-gemini");
  });

  it("should generate text response", async () => {
    mockGenerateContentStream.mockResolvedValue(makeSimpleStreamResponse("Hello from Gemini!"));

    const agent = createGeminiAgent({ apiKey: "test-key" });
    const events = await runAgent(agent, {
      systemPrompt: "You are helpful",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(events.find((e) => e.type === "text_delta")).toBeDefined();
    expect(events.find((e) => e.type === "text_done")).toBeDefined();
    expect((events.find((e) => e.type === "text_done") as any).text).toBe("Hello from Gemini!");
    expect(events.find((e) => e.type === "done")).toBeDefined();
    expect((events.find((e) => e.type === "done") as any).usage.inputTokens).toBe(10);
  });

  it("should handle function calling", async () => {
    let callCount = 0;

    mockGenerateContentStream.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        const stream = (async function* () {
          yield {
            text: () => undefined,
            candidates: [{
              content: {
                parts: [{
                  functionCall: { name: "bash", args: { command: "ls" } },
                }],
              },
            }],
          };
        })();
        return {
          stream,
          response: Promise.resolve({
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
          }),
        };
      }

      const stream = (async function* () {
        yield {
          text: () => "Files listed successfully.",
          candidates: [{
            content: { parts: [{ text: "Files listed successfully." }] },
          }],
        };
      })();
      return {
        stream,
        response: Promise.resolve({
          usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 },
        }),
      };
    });

    const agent = createGeminiAgent({ apiKey: "test-key" });
    const events = await runAgent(agent, {
      systemPrompt: "You are helpful",
      messages: [{ role: "user", content: "List files" }],
      tools: [{ name: "bash", description: "Run bash", parameters: {} }],
      toolExecutor: async (_name: string, _input: any) => ({ output: "file1.txt\nfile2.txt" }),
    });

    expect(events.find((e) => e.type === "tool_use")).toBeDefined();
    expect((events.find((e) => e.type === "tool_use") as any).name).toBe("bash");
    expect(events.find((e) => e.type === "tool_result")).toBeDefined();
    expect(events.find((e) => e.type === "text_done")).toBeDefined();
  });

  it("should configure model from config", async () => {
    mockGenerateContentStream.mockResolvedValue(makeSimpleStreamResponse("ok"));

    const agent = createGeminiAgent({ apiKey: "test-key", model: "gemini-1.5-pro" });
    await runAgent(agent);

    expect(mockGetGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gemini-1.5-pro" }),
    );
  });

  it("should configure maxTokens from config", async () => {
    mockGenerateContentStream.mockResolvedValue(makeSimpleStreamResponse("ok"));

    const agent = createGeminiAgent({ apiKey: "test-key", maxTokens: 4096 });
    await runAgent(agent);

    expect(mockGetGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({
        generationConfig: expect.objectContaining({ maxOutputTokens: 4096 }),
      }),
    );
  });

  it("should pass system instruction to model", async () => {
    mockGenerateContentStream.mockResolvedValue(makeSimpleStreamResponse("ok"));

    const agent = createGeminiAgent({ apiKey: "test-key" });
    await runAgent(agent, { systemPrompt: "Be concise" });

    expect(mockGetGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({ systemInstruction: "Be concise" }),
    );
  });

  it("should handle empty response", async () => {
    mockGenerateContentStream.mockResolvedValue(makeSimpleStreamResponse(""));

    const agent = createGeminiAgent({ apiKey: "test-key" });
    const events = await runAgent(agent);

    expect(events.find((e) => e.type === "done")).toBeDefined();
  });

  it("should support abort", () => {
    const agent = createGeminiAgent({ apiKey: "test" });
    expect(() => agent.abort()).not.toThrow();
  });

  it("should use default model when not configured", async () => {
    mockGenerateContentStream.mockResolvedValue(makeSimpleStreamResponse("ok"));

    const agent = createGeminiAgent({ apiKey: "test-key" });
    await runAgent(agent);

    expect(mockGetGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gemini-pro" }),
    );
  });

  it("should convert tools to Gemini format", async () => {
    mockGenerateContentStream.mockResolvedValue(makeSimpleStreamResponse("ok"));

    const agent = createGeminiAgent({ apiKey: "test-key" });
    await runAgent(agent, {
      tools: [
        { name: "search", description: "Search the web", parameters: { type: "object", properties: { query: { type: "string" } } } },
      ],
    });

    expect(mockGetGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({
            functionDeclarations: expect.arrayContaining([
              expect.objectContaining({ name: "search" }),
            ]),
          }),
        ]),
      }),
    );
  });
});
