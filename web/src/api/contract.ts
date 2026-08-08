// 运行界面 ↔ Python demo 的语言中立 JSON 契约（ADR-0003 第二条边界）。
// 权威定义在 contracts/demo-api.openapi.json（OpenAPI 3.0，TS/Python 共享）。
// 本文件的类型和 endpoints 是它的实现推导，改动契约须同步该文档。

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
}

export interface ChatReply {
  reply: ChatMessage;
}

export interface TokenUsage {
  input: number;
  output: number;
}

export interface TelemetrySpan {
  id: string;
  componentId: string;
  operation: string;
  startTimeMs: number;
  durationMs: number;
  tokenUsage: TokenUsage | null;
  status: "ok" | "error";
}

export interface TelemetryResponse {
  spans: TelemetrySpan[];
}

export type AblationKind = "swap" | "remove" | "override";

export interface AblationVariant {
  kind: AblationKind;
  target: string;
  description: string;
}

export interface AblationRequest {
  variant: AblationVariant;
}

export interface AblationResult {
  variant: AblationVariant;
  scores: Record<string, number>;
  spans: TelemetrySpan[];
}

export interface AblationRun {
  runId: string;
  status: "pending" | "running" | "done" | "failed";
  results: AblationResult[];
}

export interface AblationResponse {
  run: AblationRun;
}

export interface ComponentReference {
  id: string;
  version: string;
}

export interface Connection {
  from: string;
  to: string;
}

export interface Recipe {
  name?: string;
  components: ComponentReference[];
  connections: Connection[];
  parameters: Record<string, Record<string, unknown>>;
}

export interface GenerateDemoRequest {
  recipe: Recipe;
}

export type GenerateDemoStatus = "accepted" | "running" | "done" | "failed";

export interface GenerateDemoResponse {
  demoId: string;
  status: GenerateDemoStatus;
  message?: string;
}

// 运行环境配置（issue #29）：apiKey 只做掩码回显（如 sk-***abc），
// 完整值只经 server 配置 API 读写，不存前端 localStorage、不进 DOM。
export interface RuntimeConfig {
  apiKey: string;
  baseUrl: string;
  componentParams: Record<string, Record<string, unknown>>;
}

export interface ComponentPort {
  name: string;
  type: string;
}

export interface ComponentParamSpec {
  type: string;
  default?: unknown;
  enum?: unknown[] | null;
  min?: number | null;
  max?: number | null;
}

// 组件契约（来自组件注册表）：接线引擎判断"能不能接、怎么接"的依据。
export interface ComponentInfo {
  id: string;
  version: string;
  role: string;
  description: string;
  inputs: ComponentPort[];
  outputs: ComponentPort[];
  params: Record<string, ComponentParamSpec>;
}

export interface ComponentsResponse {
  components: ComponentInfo[];
}

// 调 Python demo 的统一接口（测试接缝）：MockDemoApi 与 DemoApiClient 均实现。
export interface DemoApi {
  sendChat(demoId: string, messages: ChatMessage[]): Promise<ChatReply>;
  getTelemetry(demoId: string): Promise<TelemetryResponse>;
  triggerAblation(demoId: string, request: AblationRequest): Promise<AblationResponse>;
  generateDemo(demoId: string, request: GenerateDemoRequest): Promise<GenerateDemoResponse>;
  getConfig(): Promise<RuntimeConfig>;
  updateConfig(config: Partial<RuntimeConfig>): Promise<RuntimeConfig>;
  listComponents(): Promise<ComponentsResponse>;
}

export const endpoints = {
  chat: (demoId: string) => `/demo/${demoId}/chat`,
  telemetry: (demoId: string) => `/demo/${demoId}/telemetry`,
  ablation: (demoId: string) => `/demo/${demoId}/ablations`,
  generateDemo: (demoId: string) => `/demo/${demoId}/generate`,
  config: "/config",
  components: "/components",
} as const;
