import { renderApp } from "./app.ts";
import type { AppState } from "./app.ts";
import { ChatSession } from "./panels/chatPanel.ts";
import { EvalSession } from "./panels/evalPanel.ts";
import type { AblationKind } from "./api/contract.ts";
import { MockDemoApi } from "./mockDemoApi.ts";

const DEMO_ID = "demo-1";

function mount(html: string): void {
  const app = document.getElementById("app");
  if (app) app.innerHTML = html;
}

async function main(): Promise<void> {
  const api = new MockDemoApi();
  api.setTelemetry(DEMO_ID, {
    spans: [
      {
        id: "s1",
        componentId: "model",
        operation: "chat",
        startTimeMs: Date.now(),
        durationMs: 120,
        tokenUsage: { input: 512, output: 128 },
        status: "ok",
      },
      {
        id: "s2",
        componentId: "tools",
        operation: "search",
        startTimeMs: Date.now(),
        durationMs: 34,
        tokenUsage: null,
        status: "ok",
      },
    ],
  });

  const state: AppState = {
    chat: { messages: [] },
    debug: { spans: (await api.getTelemetry(DEMO_ID)).spans },
    eval: { run: null },
  };

  function refresh(): void {
    state.chat = session.getState();
    state.eval = evalSession.getState();
    mount(renderApp(state));
  }

  // 联动监测（U3 占位）：每轮对话结束后重新拉取遥测，刷新调试面板。
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
    }
  });
}

void main();
