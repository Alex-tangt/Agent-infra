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

// 调 Python demo 的统一接口（测试接缝）：MockDemoApi 与 DemoApiClient 均实现。
export interface DemoApi {
  sendChat(demoId: string, messages: ChatMessage[]): Promise<ChatReply>;
  getTelemetry(demoId: string): Promise<TelemetryResponse>;
  triggerAblation(demoId: string, request: AblationRequest): Promise<AblationResponse>;
  generateDemo(demoId: string, request: GenerateDemoRequest): Promise<GenerateDemoResponse>;
}

export const endpoints = {
  chat: (demoId: string) => `/demo/${demoId}/chat`,
  telemetry: (demoId: string) => `/demo/${demoId}/telemetry`,
  ablation: (demoId: string) => `/demo/${demoId}/ablations`,
  generateDemo: (demoId: string) => `/demo/${demoId}/generate`,
} as const;
