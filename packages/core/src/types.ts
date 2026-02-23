// ===== CHANNELS =====

export interface Channel {
  name: string;
  connect(config: ChannelConfig): Promise<void>;
  onMessage(callback: (msg: IncomingMessage) => void): void;
  sendMessage(to: string, content: MessageContent): Promise<void>;
  sendMedia(to: string, media: MediaContent): Promise<void>;
  disconnect(): Promise<void>;
}

export interface ChannelConfig {
  [key: string]: any;
}

export interface IncomingMessage {
  id: string;
  channel: string;
  sender: string;
  senderName?: string;
  content: string;
  media?: MediaAttachment[];
  group?: string;
  groupName?: string;
  replyTo?: string;
  timestamp: Date;
  raw: any;
}

export interface MessageContent {
  text: string;
  media?: MediaAttachment[];
  replyTo?: string;
  format?: "text" | "markdown";
}

export interface MediaContent {
  type: "image" | "audio" | "video" | "document";
  data: Buffer | string;
  mimeType: string;
  filename?: string;
  caption?: string;
}

export interface MediaAttachment {
  type: "image" | "audio" | "video" | "document";
  url?: string;
  buffer?: Buffer;
  mimeType: string;
  filename?: string;
}

// ===== AGENT RUNTIMES =====

export interface AgentRuntime {
  name: string;
  run(params: {
    systemPrompt: string;
    messages: Message[];
    tools: ToolDefinition[];
    toolExecutor?: (name: string, input: any) => Promise<ToolResult>;
    onEvent?: (event: AgentEvent) => void;
  }): AsyncIterable<AgentEvent>;
  abort(): void;
}

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolCallResult[];
  timestamp?: Date;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, any>;
}

export interface ToolCallResult {
  id: string;
  output: string;
  error?: string;
}

export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "text_done"; text: string }
  | { type: "tool_use"; id: string; name: string; input: any }
  | { type: "tool_result"; id: string; output: any }
  | { type: "error"; error: Error }
  | { type: "done"; usage?: TokenUsage };

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cost?: number;
}

// ===== MEMORY =====

export interface Memory {
  name: string;
  saveMessages(sessionId: string, messages: Message[]): Promise<void>;
  loadMessages(sessionId: string, limit?: number): Promise<Message[]>;
  clear(sessionId: string): Promise<void>;
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  compact(sessionId: string): Promise<void>;
  init(): Promise<void>;
}

export interface SearchOptions {
  sessionId?: string;
  limit?: number;
  mode?: "keyword" | "semantic" | "hybrid";
  minScore?: number;
}

export interface SearchResult {
  content: string;
  score: number;
  source: string;
  metadata?: Record<string, any>;
}

// ===== SCHEDULER =====

export interface Scheduler {
  name: string;
  addJob(job: JobDefinition): Promise<string>;
  removeJob(id: string): Promise<void>;
  listJobs(): Promise<JobInfo[]>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface JobDefinition {
  id?: string;
  cron?: string;
  interval?: number;
  once?: Date;
  webhook?: { path: string; method?: string };
  event?: string;
  handler: (context: JobContext) => Promise<void>;
  metadata?: Record<string, any>;
  retries?: number;
  backoff?: "linear" | "exponential";
}

export interface JobInfo {
  id: string;
  type: "cron" | "interval" | "once" | "webhook" | "event";
  schedule?: string;
  nextRun?: Date;
  lastRun?: Date;
  runCount: number;
  metadata?: Record<string, any>;
}

export interface JobContext {
  jobId: string;
  runCount: number;
  lastRun?: Date;
  agent: AgentRuntime;
  sendMessage: (channel: string, to: string, text: string) => Promise<void>;
}

// ===== SANDBOX =====

export interface Sandbox {
  name: string;
  execute(params: {
    command: string;
    args: string[];
    cwd?: string;
    mounts?: MountPoint[];
    env?: Record<string, string>;
    timeout?: number;
    memoryLimit?: number;
    networkAccess?: boolean;
    capabilities?: string[];
  }): AsyncIterable<ExecEvent>;
  cleanup(): Promise<void>;
}

export type ExecEvent =
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "exit"; code: number };

export interface MountPoint {
  hostPath: string;
  containerPath: string;
  readonly: boolean;
}

// ===== TOOLS =====

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute(args: Record<string, any>, context: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
  workspaceDir: string;
  sessionId: string;
  sandbox?: Sandbox;
  agent?: AgentRuntime;
  sendMessage?: (channel: string, to: string, text: string) => Promise<void>;
}

export interface ToolResult {
  output: string;
  media?: MediaAttachment[];
  error?: string;
  metadata?: Record<string, any>;
}

// ===== QUEUE =====

export interface Queue {
  name: string;
  enqueue(sessionId: string, message: QueuedMessage): Promise<void>;
  process(handler: (msg: QueuedMessage) => Promise<void>): void;
  setConcurrency(limit: number): void;
  getQueueLength(sessionId?: string): Promise<number>;
  drain(): Promise<void>;
}

export interface QueuedMessage {
  id: string;
  sessionId: string;
  message: IncomingMessage;
  priority?: number;
  attempts?: number;
  maxAttempts?: number;
  enqueuedAt: Date;
}

// ===== IPC =====

export interface IPC {
  name: string;
  send(channel: string, payload: any): Promise<void>;
  onReceive(channel: string, handler: (payload: any) => void): void;
  request(channel: string, payload: any, timeout?: number): Promise<any>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

// ===== SKILLS =====

export interface SkillsManager {
  name: string;
  loadSkills(config: SkillsConfig): Promise<LoadedSkill[]>;
  getPromptSections(): PromptSection[];
  getTools(): Tool[];
  getMCPConnections(): MCPConnection[];
  install(source: string): Promise<void>;
}

export interface SkillsConfig {
  mcp?: MCPServerConfig[];
  markdown?: string[];
}

export interface MCPServerConfig {
  name: string;
  transport: "stdio" | "streamable-http" | "sse";
  command?: string;
  url?: string;
}

export interface LoadedSkill {
  name: string;
  type: "markdown" | "mcp" | "tool-bundle";
  promptSection?: string;
  tools?: Tool[];
  mcpServer?: MCPConnection;
  requirements?: { bins?: string[]; env?: string[] };
}

export interface MCPConnection {
  name: string;
  transport: "stdio" | "streamable-http" | "sse";
  command?: string;
  url?: string;
  tools?: ToolDefinition[];
}

export interface PromptSection {
  name: string;
  content: string;
  priority?: number;
}

// ===== PROMPT BUILDER =====

export interface PromptBuilder {
  name: string;
  build(context: PromptContext): Promise<string>;
}

export interface PromptContext {
  agent: {
    name?: string;
    identity?: string;
    personality?: string;
  };
  dateTime: string;
  timezone: string;
  channel: string;
  sessionType: "dm" | "group";
  group?: { name: string; memberCount: number };
  tools: ToolDefinition[];
  skills: LoadedSkill[];
  memoryContext?: string;
  workspaceFiles?: { path: string; content: string }[];
  user?: { name?: string; profile?: string; preferences?: Record<string, any> };
  maxTokens?: number;
  mode?: "full" | "minimal" | "none";
}

// ===== CONFIG =====

export interface ClawKitConfig {
  name: string;
  typescript: boolean;
  aliases: {
    components: string;
    workspace: string;
  };
  channels?: Record<string, any>;
  agent?: { name: string; [key: string]: any };
  memory?: { name: string; [key: string]: any };
  scheduler?: { name: string; [key: string]: any };
  sandbox?: { name: string; [key: string]: any };
  queue?: { name: string; [key: string]: any };
  prompt?: { name: string; [key: string]: any };
  ipc?: { name: string; [key: string]: any };
  tools?: string[];
  skills?: SkillsConfig;
}
