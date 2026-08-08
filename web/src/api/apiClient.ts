import { endpoints } from "./contract.ts";
import type {
  AblationRequest,
  AblationResponse,
  ChatMessage,
  ChatReply,
  ComponentsResponse,
  GenerateDemoRequest,
  GenerateDemoResponse,
  RuntimeConfig,
  TelemetryResponse,
} from "./contract.ts";

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

// 调 Python demo 的 HTTP 客户端。契约见 contract.ts（语言中立 JSON）。
export class DemoApiClient {
  private baseUrl: string;
  private fetchFn: Fetcher;

  constructor(baseUrl: string, fetchFn: Fetcher = fetch.bind(globalThis)) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetchFn = fetchFn;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, init);
    if (!res.ok) {
      throw new Error(`demo api ${init?.method ?? "GET"} ${path} failed: ${res.status}`);
    }
    return (await res.json()) as T;
  }

  sendChat(demoId: string, messages: ChatMessage[]): Promise<ChatReply> {
    return this.request<ChatReply>(endpoints.chat(demoId), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages }),
    });
  }

  getTelemetry(demoId: string): Promise<TelemetryResponse> {
    return this.request<TelemetryResponse>(endpoints.telemetry(demoId));
  }

  triggerAblation(demoId: string, request: AblationRequest): Promise<AblationResponse> {
    return this.request<AblationResponse>(endpoints.ablation(demoId), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
  }

  generateDemo(demoId: string, request: GenerateDemoRequest): Promise<GenerateDemoResponse> {
    return this.request<GenerateDemoResponse>(endpoints.generateDemo(demoId), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
  }

  getConfig(): Promise<RuntimeConfig> {
    return this.request<RuntimeConfig>(endpoints.config);
  }

  updateConfig(config: Partial<RuntimeConfig>): Promise<RuntimeConfig> {
    return this.request<RuntimeConfig>(endpoints.config, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config),
    });
  }

  listComponents(): Promise<ComponentsResponse> {
    return this.request<ComponentsResponse>(endpoints.components);
  }
}
