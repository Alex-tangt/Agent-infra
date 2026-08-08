import type { Recipe } from "../api/contract.ts";
import type { DemoApi } from "../api/contract.ts";
import type { BuildNote } from "../api/assemblerContract.ts";
import type {
  Answers,
  AssembleOutcome,
  AssemblerPort,
} from "../api/assemblerContract.ts";

// 生成 demo 依赖的后端入口（测试接缝）：与 DemoApi 共享，MockDemoApi 与 DemoApiClient 均满足。
export type GenerateDemoApi = Pick<DemoApi, "generateDemo">;

// 骨架默认组装器：无组装器服务时也能产出可运行 demo 代码，与 MockDemoApi 同一套 mock 思路。
// 接口见 assemblerContract.AssemblerPort（真实实现是 HTTP 客户端 AssemblerApiClient）。
export class MockAssembler implements AssemblerPort {
  async assemble(_requirement: string): Promise<AssembleOutcome> {
    return {
      status: "recipe",
      code: MOCK_DEMO_CODE,
      spec: mockSpec(),
      buildNote: mockBuildNote(),
    };
  }

  async assembleWithAnswers(
    _requirement: string,
    _answers: Answers,
  ): Promise<AssembleOutcome> {
    return {
      status: "recipe",
      code: MOCK_DEMO_CODE,
      spec: mockSpec(),
      buildNote: mockBuildNote(),
    };
  }
}

// 骨架组装器直接产出的极简 demo 代码（Python 字符串）：三件套 + 薄容器，代码即真相源。
// 与 demos/calculator_agent.py 同构：能过 AST 校验器，且可被 Python 运行时直接执行。
const MOCK_DEMO_CODE = `# 极简 agent demo（mock 组装器产出）：三件套 + 薄容器，代码即真相源。
from components.agent import Agent, register_agent
from components.context import ContextWindow, register_context
from components.model import OpenAIModel, register_model
from components.tools import Tool, ToolCaller, register_tool_caller

register_context()
register_model()
register_tool_caller()
register_agent()


def echo(text: str) -> str:
    return "已收到：" + text


context_window = ContextWindow(max_rounds=5, strategy="truncate")
model_openai = OpenAIModel(model="gpt-4o-mini", temperature=0.7, max_tokens=1024)
tool_caller = ToolCaller(
    tools=[
        Tool(
            name="echo",
            description="把用户输入原样回显",
            parameters={
                "type": "object",
                "properties": {"text": {"type": "string"}},
            },
            func=echo,
        )
    ],
    strategy="strict",
)
agent_single = Agent(
    model=model_openai,
    context=context_window,
    tools=tool_caller,
    max_iterations=3,
)
`;

// mock 的瞬态 spec：仅作生成时校验与展示参考（组件/连线/参数清单），非真相源。
function mockSpec(): Recipe {
  return {
    name: "mock-agent",
    components: [
      { id: "context-window", version: "1.0" },
      { id: "model-openai", version: "1.0" },
      { id: "tool-caller", version: "1.0" },
      { id: "agent-single", version: "1.0" },
    ],
    connections: [
      { from: "context-window", to: "agent-single" },
      { from: "model-openai", to: "agent-single" },
      { from: "tool-caller", to: "agent-single" },
    ],
    parameters: {
      "agent-single": {},
      "model-openai": { model: "gpt-4o-mini" },
    },
  };
}

function mockBuildNote(): BuildNote {
  return {
    requirement: "mock 需求",
    skillUsed: null,
    decisions: [],
    notes: [],
  };
}

export interface AssemblerPanelState {
  requirement: string;
  questions: string[] | null;
  /** demo 代码（Python 源码字符串）：面板的主产物，可编辑后一键生成运行 */
  code: string;
  /** 瞬态 spec（组件清单等）：可选展示参考，非主产物 */
  spec: Recipe | null;
  error: string | null;
  pending: boolean;
  generating: boolean;
  demoStatus: string | null;
}

// 组装会话：输入需求 → 调组装器得到 demo 代码（真实链路经 HTTP 服务，澄清问题先问后答）
// → 手动编辑代码 → 一键生成 demo。
export class AssemblerSession {
  private requirement = "";
  private questions: string[] | null = null;
  private code = "";
  private spec: Recipe | null = null;
  private error: string | null = null;
  private pending = false;
  private generating = false;
  private demoStatus: string | null = null;
  private readonly demoId: string;
  private readonly assembler: AssemblerPort;
  private readonly api: GenerateDemoApi;

  constructor(demoId: string, assembler: AssemblerPort, api: GenerateDemoApi) {
    this.demoId = demoId;
    this.assembler = assembler;
    this.api = api;
  }

  getState(): AssemblerPanelState {
    return {
      requirement: this.requirement,
      questions: this.questions,
      code: this.code,
      spec: this.spec,
      error: this.error,
      pending: this.pending,
      generating: this.generating,
      demoStatus: this.demoStatus,
    };
  }

  setRequirement(text: string): void {
    this.requirement = text;
  }

  // 生成 demo 代码：一次调用可能返回澄清问题（needsClarification）而非代码，
  // 界面展示问题 → 用户回答 → answer() 带 answers 再次调用（assembleWithAnswers）。
  async generate(): Promise<void> {
    if (this.pending) return;
    this.pending = true;
    this.error = null;
    try {
      const outcome = await this.assembler.assemble(this.requirement);
      this.applyOutcome(outcome);
    } catch (exc) {
      this.error = exc instanceof Error ? exc.message : String(exc);
    } finally {
      this.pending = false;
    }
  }

  async answer(answers: Answers): Promise<void> {
    if (this.pending) return;
    this.pending = true;
    this.error = null;
    try {
      const outcome = await this.assembler.assembleWithAnswers(
        this.requirement,
        answers,
      );
      this.applyOutcome(outcome);
    } catch (exc) {
      this.error = exc instanceof Error ? exc.message : String(exc);
    } finally {
      this.pending = false;
    }
  }

  private applyOutcome(outcome: AssembleOutcome): void {
    if (outcome.status === "clarify") {
      this.questions = outcome.questions;
      this.code = "";
      this.spec = null;
      this.demoStatus = null;
      return;
    }
    this.questions = null;
    this.code = outcome.code;
    this.spec = outcome.spec;
    this.demoStatus = null;
  }

  // 手动粘贴 / 编辑 demo 代码：代码是真相源，不做结构校验，直接采纳。
  loadCode(text: string): void {
    this.code = text;
    this.error = null;
    this.demoStatus = null;
  }

  async generateDemo(): Promise<void> {
    if (this.generating || this.code === "") return;
    this.generating = true;
    this.error = null;
    try {
      const res = await this.api.generateDemo(this.demoId, { code: this.code });
      this.demoStatus = `demo 已生成并运行（${res.demoId}，状态 ${res.status}）`;
    } finally {
      this.generating = false;
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fmtParamValue(value: unknown): string {
  if (typeof value === "string") return escapeHtml(value);
  return escapeHtml(JSON.stringify(value));
}

export function renderAssemblerPanel(state: AssemblerPanelState): string {
  const pendingDisabled = state.pending ? " disabled" : "";
  const noCode = state.code === "";
  const generateDisabled = state.generating || noCode ? " disabled" : "";

  // spec 降级为参考信息：有值时展示组件清单（组件/连线/参数），真相源始终是 demo 代码。
  const specHtml =
    state.spec === null
      ? '<p class="empty-state">暂无 spec（组装器未产出组件清单，仅以代码为准）。</p>'
      : `<div class="spec-view">
  <p class="spec-name">spec：${escapeHtml(state.spec.name ?? "（未命名）")}</p>
  <h3>组件</h3>
  <ul class="spec-components">${state.spec.components
    .map(
      (c) =>
        `<li class="spec-component" data-component-id="${escapeHtml(c.id)}">${escapeHtml(c.id)}@${escapeHtml(c.version)}</li>`,
    )
    .join("")}</ul>
  <h3>连线</h3>
  <ul class="spec-connections">${
    state.spec.connections.length === 0
      ? '<li class="empty-state">无连线。</li>'
      : state.spec.connections
          .map(
            (c) =>
              `<li class="spec-connection" data-connection="${escapeHtml(c.from)}→${escapeHtml(c.to)}">${escapeHtml(c.from)} → ${escapeHtml(c.to)}</li>`,
          )
          .join("")
  }</ul>
  <h3>参数</h3>
  <ul class="spec-parameters">${
    Object.keys(state.spec.parameters).length === 0
      ? '<li class="empty-state">无参数。</li>'
      : Object.entries(state.spec.parameters)
          .map(
            ([componentId, params]) =>
              `<li class="spec-parameter" data-component-id="${escapeHtml(componentId)}">${escapeHtml(componentId)}: ${Object.entries(params)
                .map(([k, v]) => `${escapeHtml(k)}=${fmtParamValue(v)}`)
                .join(", ")}</li>`,
          )
          .join("")
  }</ul>
</div>`;

  const questions = state.questions;
  const questionHtml =
    questions && questions.length > 0
      ? `<form class="assembler-answers">
  <p class="assembler-questions">${questions
    .map((q) => `<span class="assembler-question" data-question="${escapeHtml(q)}">${escapeHtml(q)}</span>`)
    .join(" ")}</p>
  <input name="model" type="text" placeholder="模型（如 gpt-4o）"${pendingDisabled} />
  <input name="tools" type="text" placeholder="工具（逗号分隔，如：天气、搜索）"${pendingDisabled} />
  <button type="submit"${pendingDisabled}>提交答案</button>
</form>`
      : "";

  return `<section class="panel assembler-panel">
  <h2>组装器</h2>
  <form class="assembler-requirement">
    <input name="requirement" type="text" value="${escapeHtml(state.requirement)}" placeholder="描述需求，如：会查天气的 agent"${pendingDisabled} />
    <button type="submit"${pendingDisabled}>生成 demo 代码</button>
  </form>
  ${questionHtml}
  <form class="assembler-code">
    <textarea name="code" rows="10" placeholder="demo 代码（Python，可直接编辑）…"${pendingDisabled}>${escapeHtml(state.code)}</textarea>
    <button type="submit"${pendingDisabled}>应用代码</button>
  </form>
  <form class="demo-generate">
    <button type="submit"${generateDisabled}>生成 demo 并运行</button>
  </form>
  ${
    state.error
      ? `<p class="assembler-error" data-error="${escapeHtml(state.error)}">${escapeHtml(state.error)}</p>`
      : ""
  }
  ${
    state.demoStatus
      ? `<p class="demo-status" data-demo-status="${escapeHtml(state.demoStatus)}">${escapeHtml(state.demoStatus)}</p>`
      : ""
  }
  <div class="spec-visual">${specHtml}</div>
</section>`;
}
