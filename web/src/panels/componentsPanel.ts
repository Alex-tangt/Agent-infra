import type {
  ComponentInfo,
  ComponentParamSpec,
  RuntimeConfig,
} from "../api/contract.ts";
import type { DemoApi } from "../api/contract.ts";

// 组件库面板依赖的接口契约（测试接缝）：与 DemoApi 共享，MockDemoApi 与 DemoApiClient 均满足。
export type ComponentsApi = Pick<DemoApi, "listComponents" | "getConfig" | "updateConfig">;

export interface ComponentsPanelState {
  components: ComponentInfo[];
  selectedId: string | null;
  // 运行环境配置：apiKey 掩码回显，完整值不落前端（见 contracts/demo-api.openapi.json）。
  config: RuntimeConfig | null;
  error: string | null;
  pending: boolean;
  saving: boolean;
  saved: boolean;
}

// 组件库会话：拉取组件目录与运行环境配置 → 选中组件看说明书 → 编辑并保存默认设置。
export class ComponentsSession {
  private components: ComponentInfo[] = [];
  private selectedId: string | null = null;
  private config: RuntimeConfig | null = null;
  private error: string | null = null;
  private pending = false;
  private saving = false;
  private saved = false;
  private readonly api: ComponentsApi;

  constructor(api: ComponentsApi) {
    this.api = api;
  }

  getState(): ComponentsPanelState {
    return {
      components: [...this.components],
      selectedId: this.selectedId,
      config: this.config,
      error: this.error,
      pending: this.pending,
      saving: this.saving,
      saved: this.saved,
    };
  }

  async load(): Promise<void> {
    if (this.pending) return;
    this.pending = true;
    this.error = null;
    try {
      const [components, config] = await Promise.all([
        this.api.listComponents(),
        this.api.getConfig(),
      ]);
      this.components = components.components;
      this.config = config;
      // 默认选中第一个组件，说明书与默认设置编辑立即可见。
      if (this.selectedId === null && this.components.length > 0) {
        this.selectedId = this.components[0]!.id;
      }
      this.saved = false;
    } catch (exc) {
      this.error = exc instanceof Error ? exc.message : String(exc);
    } finally {
      this.pending = false;
    }
  }

  select(componentId: string): void {
    if (this.components.some((c) => c.id === componentId)) {
      this.selectedId = componentId;
      this.saved = false;
    }
  }

  async saveConfig(payload: Partial<RuntimeConfig>): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    this.error = null;
    this.saved = false;
    try {
      this.config = await this.api.updateConfig(payload);
      this.saved = true;
    } catch (exc) {
      this.error = exc instanceof Error ? exc.message : String(exc);
    } finally {
      this.saving = false;
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

// 按参数类型解析表单里的字符串值：number/integer 转数值，其余保持字符串。
export function parseParamValue(raw: string, spec: ComponentParamSpec): unknown {
  const text = raw.trim();
  if (text === "") return "";
  if (spec.type === "integer") {
    const n = Number(text);
    return Number.isInteger(n) ? n : text;
  }
  if (spec.type === "number") {
    const n = Number(text);
    return Number.isFinite(n) ? n : text;
  }
  return text;
}

// 把表单收集到的原始字符串值按组件参数契约解析成结构化参数（供 PUT /config）。
export function parseParamValues(
  rawValues: Record<string, string>,
  selected: ComponentInfo,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [name, raw] of Object.entries(rawValues)) {
    const spec = selected.params[name];
    params[name] = spec ? parseParamValue(raw, spec) : raw;
  }
  return params;
}

function renderCatalog(state: ComponentsPanelState): string {
  if (state.components.length === 0) {
    return '<p class="empty-state">暂无组件（server 未返回组件目录）。</p>';
  }
  return `<ul class="component-catalog">${state.components
    .map(
      (c) =>
        `<li class="component-catalog-item${state.selectedId === c.id ? " is-active" : ""}" data-component-id="${escapeHtml(c.id)}">
  <span class="component-name">${escapeHtml(c.id)}@${escapeHtml(c.version)}</span>
  <span class="component-role" data-role="${escapeHtml(c.role)}">${escapeHtml(c.role)}</span>
  <p class="component-desc">${escapeHtml(c.description)}</p>
</li>`,
    )
    .join("")}</ul>`;
}

function renderPorts(ports: ComponentInfo["inputs"]): string {
  if (ports.length === 0) return '<li class="empty-state">无。</li>';
  return ports
    .map((p) => `<li data-port-name="${escapeHtml(p.name)}">${escapeHtml(p.name)} : ${escapeHtml(p.type)}</li>`)
    .join("");
}

function renderManual(selected: ComponentInfo | null): string {
  if (selected === null) {
    return '<p class="empty-state">点击左侧组件查看说明书与默认设置。</p>';
  }
  const paramsHtml =
    Object.keys(selected.params).length === 0
      ? '<li class="empty-state">无参数。</li>'
      : Object.entries(selected.params)
          .map(([name, spec]) => {
            const bits = [`type=${escapeHtml(spec.type)}`];
            if (spec.default !== undefined && spec.default !== null) {
              bits.push(`default=${escapeHtml(String(spec.default))}`);
            }
            if (spec.enum && spec.enum.length > 0) {
              bits.push(`enum=[${spec.enum.map((e) => escapeHtml(String(e))).join(", ")}]`);
            }
            if (spec.min !== null && spec.min !== undefined) bits.push(`min=${escapeHtml(String(spec.min))}`);
            if (spec.max !== null && spec.max !== undefined) bits.push(`max=${escapeHtml(String(spec.max))}`);
            return `<li data-param-name="${escapeHtml(name)}">${escapeHtml(name)}（${bits.join("，")}）</li>`;
          })
          .join("");
  return `<div class="component-manual">
  <h3 class="manual-title">${escapeHtml(selected.id)}@${escapeHtml(selected.version)}</h3>
  <p class="manual-role" data-role="${escapeHtml(selected.role)}">角色：${escapeHtml(selected.role)}</p>
  <p class="manual-desc">${escapeHtml(selected.description)}</p>
  <h4>输入</h4>
  <ul class="manual-ports">${renderPorts(selected.inputs)}</ul>
  <h4>输出</h4>
  <ul class="manual-ports">${renderPorts(selected.outputs)}</ul>
  <h4>参数</h4>
  <ul class="manual-params">${paramsHtml}</ul>
</div>`;
}

function renderParamInput(name: string, spec: ComponentParamSpec, value: unknown): string {
  const current = String(value ?? spec.default ?? "");
  if (spec.enum && spec.enum.length > 0) {
    const options = spec.enum
      .map(
        (opt) =>
          `<option value="${escapeHtml(String(opt))}"${String(opt) === current ? " selected" : ""}>${escapeHtml(String(opt))}</option>`,
      )
      .join("");
    return `<select data-param="${escapeHtml(name)}">${options}</select>`;
  }
  return `<input data-param="${escapeHtml(name)}" type="text" value="${escapeHtml(current)}" />`;
}

function renderConfigForm(state: ComponentsPanelState): string {
  const config = state.config;
  const apiKey = config?.apiKey ?? "";
  const baseUrl = config?.baseUrl ?? "";
  const selected = state.components.find((c) => c.id === state.selectedId) ?? null;
  const disabled = state.saving ? " disabled" : "";

  const paramFields =
    selected === null
      ? '<p class="empty-state">选择一个组件后可编辑其默认参数。</p>'
      : Object.entries(selected.params)
          .map(([name, spec]) => {
            const saved = config?.componentParams?.[selected.id]?.[name];
            return `<label class="config-param"><span>${escapeHtml(name)} <em>(${escapeHtml(spec.type)})</em></span>${renderParamInput(name, spec, saved)}</label>`;
          })
          .join("");

  return `<form class="config-form">
  <h3>默认设置（持久化到 server/config.json）</h3>
  <label class="config-field"><span>api key（掩码回显，完整值只存 server）</span><input name="apiKey" type="text" value="${escapeHtml(apiKey)}" placeholder="留空 = 离线兜底模型"${disabled} /></label>
  <label class="config-field"><span>base url</span><input name="baseUrl" type="text" value="${escapeHtml(baseUrl)}" placeholder="https://api.openai.com/v1"${disabled} /></label>
  <div class="config-params">${paramFields}</div>
  <button type="submit" class="config-save"${disabled}>保存默认设置</button>
</form>`;
}

export function renderComponentsPanel(state: ComponentsPanelState): string {
  const statusHtml =
    state.saved
      ? '<p class="config-status config-saved" data-config-status="saved">已保存。</p>'
      : state.error
        ? `<p class="config-status config-error" data-config-status="error">${escapeHtml(state.error)}</p>`
        : "";
  return `<section class="panel components-panel">
  <h2>组件库</h2>
  ${renderCatalog(state)}
  ${renderManual(state.components.find((c) => c.id === state.selectedId) ?? null)}
  ${renderConfigForm(state)}
  ${statusHtml}
</section>`;
}
