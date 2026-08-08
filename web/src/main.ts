import { renderApp } from "./app.ts";
import type { AppState } from "./app.ts";
import { ChatSession } from "./panels/chatPanel.ts";
import { EvalSession } from "./panels/evalPanel.ts";
import { AssemblerSession, MockAssembler } from "./panels/assemblerPanel.ts";
import type { AblationKind, TelemetrySpan } from "./api/contract.ts";
import { createDemoApi } from "./api/createDemoApi.ts";

const DEMO_ID = "demo-1";

function mount(html: string): void {
  const app = document.getElementById("app");
  if (app) app.innerHTML = html;
}

async function main(): Promise<void> {
  // 端到端链路默认连 Python demo server（DemoApiClient）；`?mock=1` 回退骨架假后端。
  const api = createDemoApi();

  // 组装器联动（U5）：需求→配方→一键生成 demo；配方产出交给真实接线引擎（或 mock）落地运行。
  const assemblerSession = new AssemblerSession(DEMO_ID, new MockAssembler(), api);

  // demo 尚未生成时 telemetry 会 404，启动期容错为空，避免拖垮整个 UI。
  const initialTelemetry = await api
    .getTelemetry(DEMO_ID)
    .catch(() => ({ spans: [] as TelemetrySpan[] }));

  const state: AppState = {
    chat: { messages: [] },
    debug: { spans: initialTelemetry.spans },
    eval: { run: null },
    assembler: assemblerSession.getState(),
  };

  function refresh(): void {
    state.chat = session.getState();
    state.eval = evalSession.getState();
    state.assembler = assemblerSession.getState();
    mount(renderApp(state));
  }

  // 联动监测：每轮对话结束后重新拉取真实遥测流，刷新调试面板。
  const session = new ChatSession(DEMO_ID, api, async () => {
    const telemetry = await api.getTelemetry(DEMO_ID);
    state.debug = { spans: telemetry.spans };
    refresh();
  });

  const evalSession = new EvalSession(DEMO_ID, api);

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
    }
  });
}

void main();
