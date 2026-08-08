import type {
  AblationRequest,
  AblationResponse,
  ChatMessage,
  ChatReply,
  ComponentsResponse,
  DemoApi,
  GenerateDemoRequest,
  GenerateDemoResponse,
  RuntimeConfig,
  TelemetryResponse,
} from "./api/contract.ts";

// 内存假后端：骨架独立运行 / 测试时替代 Python demo。
export class MockDemoApi implements DemoApi {
  private telemetryByDemo = new Map<string, TelemetryResponse>();
  private config: RuntimeConfig = { apiKey: "", baseUrl: "", componentParams: {} };

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

  async getConfig(): Promise<RuntimeConfig> {
    return { ...this.config, componentParams: structuredClone(this.config.componentParams) };
  }

  async updateConfig(config: Partial<RuntimeConfig>): Promise<RuntimeConfig> {
    if (config.apiKey !== undefined && !config.apiKey.includes("***")) {
      this.config.apiKey = config.apiKey;
    }
    if (config.baseUrl !== undefined) this.config.baseUrl = config.baseUrl;
    if (config.componentParams !== undefined) {
      this.config.componentParams = {
        ...this.config.componentParams,
        ...config.componentParams,
      };
    }
    return this.getConfig();
  }

  async listComponents(): Promise<ComponentsResponse> {
    return { components: MOCK_COMPONENTS };
  }
}

// 骨架假后端的组件目录：与真实注册表（model-openai/context-window/tool-caller/agent-single）对齐。
const MOCK_COMPONENTS: ComponentsResponse["components"] = [
  {
    id: "model-openai",
    version: "1.0",
    role: "model",
    description: "OpenAI 兼容大模型封装组件：接收消息列表，透传原生工具 schema。",
    inputs: [{ name: "messages", type: "MessageList" }],
    outputs: [{ name: "response", type: "string" }],
    params: {
      model: { type: "string", default: "gpt-4o-mini", enum: ["gpt-4o-mini", "gpt-4o"] },
      temperature: { type: "number", default: 0.7, min: 0, max: 2 },
      max_tokens: { type: "number", default: 1024, min: 1, max: 16384 },
    },
  },
  {
    id: "context-window",
    version: "1.0",
    role: "context",
    description: "上下文窗口组件：维护对话消息列表，支持轮次截断与 system prompt 注入。",
    inputs: [{ name: "user_message", type: "string" }],
    outputs: [{ name: "messages", type: "MessageList" }],
    params: {
      max_rounds: { type: "integer", default: 5, min: 1 },
      strategy: { type: "string", default: "truncate", enum: ["truncate"] },
    },
  },
  {
    id: "tool-caller",
    version: "1.0",
    role: "tools",
    description: "外部能力挂载点：把工具执行结果回填到上下文。",
    inputs: [{ name: "request", type: "ToolRequest" }],
    outputs: [{ name: "result", type: "ToolCallResult" }],
    params: {
      tools: { type: "list", default: [] },
      policy: { type: "string", default: "strict", enum: ["strict", "lenient"] },
    },
  },
  {
    id: "agent-single",
    version: "1.0",
    role: "agent",
    description: "单体 agent 薄容器组件：编排模型、上下文与工具执行器。",
    inputs: [{ name: "user_message", type: "string" }],
    outputs: [{ name: "reply", type: "string" }],
    params: {
      max_iterations: { type: "integer", default: 5, min: 1 },
    },
  },
];
