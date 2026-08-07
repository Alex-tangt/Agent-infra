import type {
  AblationRequest,
  AblationResponse,
  ChatMessage,
  ChatReply,
  DemoApi,
  GenerateDemoRequest,
  GenerateDemoResponse,
  TelemetryResponse,
} from "./api/contract.ts";

// 内存假后端：骨架独立运行 / 测试时替代 Python demo。
export class MockDemoApi implements DemoApi {
  private telemetryByDemo = new Map<string, TelemetryResponse>();

  setTelemetry(demoId: string, response: TelemetryResponse): void {
    this.telemetryByDemo.set(demoId, response);
  }

  async sendChat(demoId: string, messages: ChatMessage[]): Promise<ChatReply> {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    return {
      reply: {
        role: "assistant",
        content: `mock 收到：${lastUser?.content ?? "（空）"}`,
      },
    };
  }

  async getTelemetry(demoId: string): Promise<TelemetryResponse> {
    return this.telemetryByDemo.get(demoId) ?? { spans: [] };
  }

  async triggerAblation(demoId: string, request: AblationRequest): Promise<AblationResponse> {
    return {
      run: {
        runId: `mock-run-${request.variant.kind}-${request.variant.target}`,
        status: "done",
        results: [
          {
            variant: request.variant,
            scores: { quality: 0.8, latency: 0.7 },
            spans: (await this.getTelemetry(demoId)).spans,
          },
        ],
      },
    };
  }

  // mock 接线引擎入口：接受配方即返回成功，供骨架独立运行 / 测试替代真实后端。
  async generateDemo(
    demoId: string,
    request: GenerateDemoRequest,
  ): Promise<GenerateDemoResponse> {
    return {
      demoId,
      status: "done",
      message: `mock 接线引擎已接受配方（${request.recipe.components.length} 个组件）`,
    };
  }
}
