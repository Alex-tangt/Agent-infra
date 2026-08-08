import { renderApp } from "./app.ts";
import type { AppState, AppView } from "./app.ts";
import { ChatSession } from "./panels/chatPanel.ts";
import { EvalSession } from "./panels/evalPanel.ts";
import { AssemblerSession } from "./panels/assemblerPanel.ts";
import { ComponentsSession, parseParamValues } from "./panels/componentsPanel.ts";
import type { RuntimeConfig } from "./api/contract.ts";
import type { AblationKind, TelemetrySpan } from "./api/contract.ts";
import type { Answers } from "./api/assemblerContract.ts";
import { createDemoApi } from "./api/createDemoApi.ts";
import { createAssemblerApi } from "./api/createAssemblerApi.ts";

const DEMO_ID = "demo-1";

function mount(html: string): void {
  const app = document.getElementById("app");
  if (app) app.innerHTML = html;
}

async function main(): Promise<void> {
  // 端到端链路默认连 Python demo server（DemoApiClient）；`?mock=1` 回退骨架假后端。
  const api = createDemoApi();

  // 组装器联动（U5）：需求→配方→一键生成 demo；组装器经真实 HTTP 服务（AssemblerApiClient）
  // 走 acquire→clarify/convert 编排，`?mock=1` 时回退骨架假组装器。
  const assemblerSession = new AssemblerSession(DEMO_ID, createAssemblerApi(), api);

  // 组件库（issue #29）：拉取组件目录 + 运行环境配置（api key 掩码回显）。
  const componentsSession = new ComponentsSession(api);

  // demo 尚未生成时 telemetry 会 404，启动期容错为空，避免拖垮整个 UI。
  const initialTelemetry = await api
    .getTelemetry(DEMO_ID)
    .catch(() => ({ spans: [] as TelemetrySpan[] }));

  // 组件目录/配置拉取失败时以空态渲染（面板内展示错误），不阻塞启动。
  await componentsSession.load();

  const state: AppState = {
    view: "assembler",
    chat: { messages: [] },
    debug: { spans: initialTelemetry.spans },
    eval: { run: null },
    assembler: assemblerSession.getState(),
    components: componentsSession.getState(),
  };

  function refresh(): void {
    state.chat = session.getState();
    state.eval = evalSession.getState();
    state.assembler = assemblerSession.getState();
    state.components = componentsSession.getState();
    mount(renderApp(state));
  }

  // 联动监测：每轮对话结束后重新拉取真实遥测流，刷新调试面板。
  const session = new ChatSession(DEMO_ID, api, async () => {
    const telemetry = await api.getTelemetry(DEMO_ID);
    state.debug = { spans: telemetry.spans };
    refresh();
  });

  const evalSession = new EvalSession(DEMO_ID, api);

  // 从默认设置表单收集配置并保存：api key 掩码占位（含 ***）视为未改动，不覆盖真实 key。
  async function saveConfigFromForm(
    form: HTMLFormElement,
    appState: AppState,
  ): Promise<void> {
    const apiKeyEl = form.elements.namedItem("apiKey") as HTMLInputElement | null;
    const baseUrlEl = form.elements.namedItem("baseUrl") as HTMLInputElement | null;
    const payload: Partial<RuntimeConfig> = {};
    const apiKey = apiKeyEl?.value ?? "";
    if (!apiKey.includes("***")) payload.apiKey = apiKey;
    if (baseUrlEl) payload.baseUrl = baseUrlEl.value;

    const selectedId = appState.components.selectedId;
    const selected =
      appState.components.components.find((c) => c.id === selectedId) ?? null;
    if (selected !== null) {
      const rawValues: Record<string, string> = {};
      for (const el of Array.from(form.querySelectorAll("[data-param]"))) {
        const name = el.getAttribute("data-param");
        if (name) rawValues[name] = (el as HTMLInputElement | HTMLSelectElement).value;
      }
      payload.componentParams = { [selected.id]: parseParamValues(rawValues, selected) };
    }
    await componentsSession.saveConfig(payload);
  }

  refresh();

  const app = document.getElementById("app");
  app?.addEventListener("submit", (event) => {
    const target = event.target as HTMLFormElement | null;
    if (!target) return;
    if (target.classList.contains("chat-input")) {
      event.preventDefault();
      const input = target.elements.namedItem("text") as HTMLInputElement | null;
      const text = input?.value ?? "";
      if (input) input.value = "";
      void session.sendMessage(text).catch(() => refresh());
      refresh();
      return;
    }
    if (target.classList.contains("ablation-form")) {
      event.preventDefault();
      const kind = target.elements.namedItem("kind") as HTMLSelectElement | null;
      const targetEl = target.elements.namedItem("target") as HTMLInputElement | null;
      const descEl = target.elements.namedItem("description") as HTMLInputElement | null;
      const variantTarget = targetEl?.value.trim() ?? "";
      if (variantTarget === "") return;
      void evalSession
        .startRun({
          kind: (kind?.value as AblationKind) ?? "swap",
          target: variantTarget,
          description: descEl?.value.trim() ?? "",
        })
        .then(() => refresh())
        .catch(() => refresh());
      refresh();
      return;
    }
    if (target.classList.contains("assembler-requirement")) {
      event.preventDefault();
      const input = target.elements.namedItem("requirement") as HTMLInputElement | null;
      const text = input?.value ?? "";
      assemblerSession.setRequirement(text);
      void assemblerSession
        .generate()
        .then(() => refresh())
        .catch(() => refresh());
      refresh();
      return;
    }
    if (target.classList.contains("assembler-answers")) {
      event.preventDefault();
      const modelEl = target.elements.namedItem("model") as HTMLInputElement | null;
      const toolsEl = target.elements.namedItem("tools") as HTMLInputElement | null;
      const answers: Answers = {};
      const model = modelEl?.value.trim() ?? "";
      if (model !== "") answers.model = model;
      const tools = (toolsEl?.value ?? "")
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter((t) => t !== "");
      if (tools.length > 0) answers.tools = tools;
      void assemblerSession
        .answer(answers)
        .then(() => refresh())
        .catch(() => refresh());
      refresh();
      return;
    }
    if (target.classList.contains("assembler-json")) {
      event.preventDefault();
      const jsonEl = target.elements.namedItem("json") as HTMLTextAreaElement | null;
      assemblerSession.loadJson(jsonEl?.value ?? "");
      refresh();
      return;
    }
    if (target.classList.contains("demo-generate")) {
      event.preventDefault();
      void assemblerSession
        .generateDemo()
        .then(() => refresh())
        .catch(() => refresh());
      refresh();
      return;
    }
    if (target.classList.contains("config-form")) {
      event.preventDefault();
      void saveConfigFromForm(target, state)
        .then(() => refresh())
        .catch(() => refresh());
      refresh();
    }
  });

  // tab 切换与组件库选中：切换 tab 不丢会话状态（状态都在 AppState 里）。
  app?.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const tab = target.closest<HTMLElement>("[data-view]");
    if (tab) {
      state.view = tab.dataset.view as AppView;
      refresh();
      return;
    }
    const item = target.closest<HTMLElement>("[data-component-id]");
    if (item && state.view === "components") {
      componentsSession.select(item.dataset.componentId ?? "");
      refresh();
    }
  });
}

void main();
