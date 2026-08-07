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

export const endpoints = {
  chat: (demoId: string) => `/demo/${demoId}/chat`,
  telemetry: (demoId: string) => `/demo/${demoId}/telemetry`,
  ablation: (demoId: string) => `/demo/${demoId}/ablations`,
} as const;
