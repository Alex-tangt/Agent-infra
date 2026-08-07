import { renderApp } from "./app.ts";
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

  const telemetry = await api.getTelemetry(DEMO_ID);
  mount(
    renderApp({
      chat: { messages: [{ role: "assistant", content: "你好，我是 demo。有什么可以帮你？" }] },
      debug: { spans: telemetry.spans },
      eval: { run: null },
    }),
  );
}

void main();
