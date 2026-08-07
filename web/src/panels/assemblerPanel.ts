import type { Recipe } from "../api/contract.ts";
import type { DemoApi } from "../mockDemoApi.ts";

// 组装器联动面板依赖的接口契约（测试接缝）：真实实现是 assembler 的 requirementToRecipe
// 纯函数（测试直接 import 组装器源码走真实链路），也可注入 mock。
export interface AssemblerPort {
  requirementToRecipe(requirement: string): Recipe;
}

// 生成 demo 依赖的后端入口（测试接缝）：与 DemoApi 共享，MockDemoApi 与 DemoApiClient 均满足。
export type GenerateDemoApi = Pick<DemoApi, "generateDemo">;

// 骨架默认组装器：无后端时也能产出可运行配方，与 MockDemoApi 同一套 mock 思路。
export class MockAssembler implements AssemblerPort {
  requirementToRecipe(_requirement: string): Recipe {
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
}

export interface AssemblerPanelState {
  requirement: string;
  recipe: Recipe | null;
  json: string;
  error: string | null;
  pending: boolean;
  generating: boolean;
  demoStatus: string | null;
}

function isRecipe(value: unknown): value is Recipe {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.components)) return false;
  if (!Array.isArray(record.connections)) return false;
  if (typeof record.parameters !== "object" || record.parameters === null) return false;
  return record.components.every(
    (c) =>
      typeof c === "object" &&
      c !== null &&
      typeof (c as Record<string, unknown>).id === "string" &&
      typeof (c as Record<string, unknown>).version === "string",
  );
}

// 组装会话：输入需求 → 调组装器得到配方 → 手动粘贴/编辑配方 JSON → 一键生成 demo。
export class AssemblerSession {
  private requirement = "";
  private recipe: Recipe | null = null;
  private json = "";
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
      recipe: this.recipe,
      json: this.json,
      error: this.error,
      pending: this.pending,
      generating: this.generating,
      demoStatus: this.demoStatus,
    };
  }

  setRequirement(text: string): void {
    this.requirement = text;
  }

  async generate(): Promise<void> {
    if (this.pending) return;
    this.pending = true;
    this.error = null;
    try {
      const recipe = this.assembler.requirementToRecipe(this.requirement);
      this.recipe = recipe;
      this.json = JSON.stringify(recipe, null, 2);
      this.demoStatus = null;
    } finally {
      this.pending = false;
    }
  }

  loadJson(text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.error = "配方 JSON 无效";
      return;
    }
    if (!isRecipe(parsed)) {
      this.error = "配方结构不符合契约（需要 components/connections/parameters）";
      return;
    }
    this.recipe = parsed;
    this.json = JSON.stringify(parsed, null, 2);
    this.error = null;
    this.demoStatus = null;
  }

  async generateDemo(): Promise<void> {
    if (this.generating || this.recipe === null) return;
    this.generating = true;
    this.error = null;
    try {
      const res = await this.api.generateDemo(this.demoId, { recipe: this.recipe });
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
  const noRecipe = state.recipe === null;
  const generateDisabled = state.generating || noRecipe ? " disabled" : "";

  const viewHtml =
    state.recipe === null
      ? '<p class="empty-state">暂无配方。输入需求生成，或粘贴配方 JSON。</p>'
      : `<div class="recipe-view">
  <p class="recipe-name">配方：${escapeHtml(state.recipe.name ?? "（未命名）")}</p>
  <h3>组件</h3>
  <ul class="recipe-components">${state.recipe.components
    .map(
      (c) =>
        `<li class="recipe-component" data-component-id="${escapeHtml(c.id)}">${escapeHtml(c.id)}@${escapeHtml(c.version)}</li>`,
    )
    .join("")}</ul>
  <h3>连线</h3>
  <ul class="recipe-connections">${
    state.recipe.connections.length === 0
      ? '<li class="empty-state">无连线。</li>'
      : state.recipe.connections
          .map(
            (c) =>
              `<li class="recipe-connection" data-connection="${escapeHtml(c.from)}→${escapeHtml(c.to)}">${escapeHtml(c.from)} → ${escapeHtml(c.to)}</li>`,
          )
          .join("")
  }</ul>
  <h3>参数</h3>
  <ul class="recipe-parameters">${
    Object.keys(state.recipe.parameters).length === 0
      ? '<li class="empty-state">无参数。</li>'
      : Object.entries(state.recipe.parameters)
          .map(
            ([componentId, params]) =>
              `<li class="recipe-parameter" data-component-id="${escapeHtml(componentId)}">${escapeHtml(componentId)}: ${Object.entries(params)
                .map(([k, v]) => `${escapeHtml(k)}=${fmtParamValue(v)}`)
                .join(", ")}</li>`,
          )
          .join("")
  }</ul>
</div>`;

  return `<section class="panel assembler-panel">
  <h2>组装器</h2>
  <form class="assembler-requirement">
    <input name="requirement" type="text" value="${escapeHtml(state.requirement)}" placeholder="描述需求，如：会查天气的 agent"${pendingDisabled} />
    <button type="submit"${pendingDisabled}>生成配方</button>
  </form>
  <form class="assembler-json">
    <textarea name="json" rows="6" placeholder="或直接粘贴配方 JSON…"${pendingDisabled}>${escapeHtml(state.json)}</textarea>
    <button type="submit"${pendingDisabled}>应用配方</button>
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
  <div class="recipe-visual">${viewHtml}</div>
</section>`;
}
