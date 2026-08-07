import { test } from "node:test";
import assert from "node:assert/strict";

import { renderApp } from "../src/app.ts";
import type { AppState } from "../src/app.ts";

function baseState(): AppState {
  return {
    chat: { messages: [] },
    debug: { spans: [] },
    eval: { run: null },
    assembler: {
      requirement: "",
      recipe: null,
      json: "",
      error: null,
      pending: false,
      generating: false,
      demoStatus: null,
    },
  };
}

test("app renders three panels plus the assembler entry in place", () => {
  const state = baseState();
  const html = renderApp(state);

  assert.match(html, /chat-panel/);
  assert.match(html, /debug-panel/);
  assert.match(html, /eval-panel/);
  assert.match(html, /assembler-panel/);
  const chatIdx = html.indexOf("chat-panel");
  const debugIdx = html.indexOf("debug-panel");
  const evalIdx = html.indexOf("eval-panel");
  const assemblerIdx = html.indexOf("assembler-panel");
  assert.ok(chatIdx >= 0 && debugIdx > chatIdx && evalIdx > debugIdx && assemblerIdx > evalIdx);
});

test("app renders with fake data filling all four panels", () => {
  const state: AppState = {
    ...baseState(),
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
    assembler: {
      requirement: "会查天气的 agent",
      recipe: {
        name: "weather-agent",
        components: [
          { id: "context-window", version: "1.0" },
          { id: "model-openai", version: "1.0" },
        ],
        connections: [{ from: "context-window", to: "model-openai" }],
        parameters: {},
      },
      json: "",
      error: null,
      pending: false,
      generating: false,
      demoStatus: null,
    },
  };
  const html = renderApp(state);

  assert.match(html, /hi/);
  assert.match(html, /model/);
  assert.match(html, /换掉工具组件/);
  assert.match(html, /weather-agent/);
  assert.match(html, /context-window/);
});
