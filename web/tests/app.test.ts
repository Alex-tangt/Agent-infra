import { test } from "node:test";
import assert from "node:assert/strict";

import { renderApp } from "../src/app.ts";
import type { AppState } from "../src/app.ts";

test("app renders three panels in place", () => {
  const state: AppState = {
    chat: { messages: [] },
    debug: { spans: [] },
    eval: { run: null },
  };
  const html = renderApp(state);

  assert.match(html, /chat-panel/);
  assert.match(html, /debug-panel/);
  assert.match(html, /eval-panel/);
  const chatIdx = html.indexOf("chat-panel");
  const debugIdx = html.indexOf("debug-panel");
  const evalIdx = html.indexOf("eval-panel");
  assert.ok(chatIdx >= 0 && debugIdx > chatIdx && evalIdx > debugIdx);
});

test("app renders with fake data filling all three panels", () => {
  const state: AppState = {
    chat: { messages: [{ role: "user", content: "hi" }] },
    debug: {
      spans: [
        {
          id: "s1",
          componentId: "model",
          operation: "chat",
          startTimeMs: 0,
          durationMs: 12,
          tokenUsage: { input: 3, output: 2 },
          status: "ok",
        },
      ],
    },
    eval: {
      run: {
        runId: "r1",
        status: "done",
        results: [
          {
            variant: { kind: "swap", target: "tools", description: "换掉工具组件" },
            scores: { quality: 0.8 },
            spans: [],
          },
        ],
      },
    },
  };
  const html = renderApp(state);

  assert.match(html, /hi/);
  assert.match(html, /model/);
  assert.match(html, /换掉工具组件/);
});
