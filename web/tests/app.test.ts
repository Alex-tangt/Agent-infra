import { test } from "node:test";
import assert from "node:assert/strict";

import { renderApp } from "../src/app.ts";
import type { AppState, AppView } from "../src/app.ts";

function baseState(): AppState {
  return {
    view: "assembler",
    chat: { messages: [] },
    debug: { spans: [] },
    eval: { run: null },
    assembler: {
      requirement: "",
      questions: null,
      recipe: null,
      json: "",
      error: null,
      pending: false,
      generating: false,
      demoStatus: null,
    },
    components: {
      components: [],
      selectedId: null,
      config: null,
      error: null,
      pending: false,
      saving: false,
      saved: false,
    },
  };
}

test("app renders five tabs and one active view at a time", () => {
  const html = renderApp(baseState());

  // 顶部 tab：组装器 / 聊天 / 调试/监测 / 评估 / 组件库
  for (const label of ["组装器", "聊天", "调试/监测", "评估", "组件库"]) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /runtime-ui-tab/);
  // 默认视图：组装器面板在视图中渲染
  assert.match(html, /assembler-panel/);
  // 其他面板不在当前视图中出现（单页一次显示一个视图）
  assert.ok(!html.includes("chat-panel"));
  assert.ok(!html.includes("debug-panel"));
  assert.ok(!html.includes("eval-panel"));
  assert.ok(!html.includes("components-panel"));
});

test("app renders only the active view per tab", () => {
  const views: AppView[] = ["assembler", "chat", "debug", "eval", "components"];
  const expected: Record<AppView, RegExp> = {
    assembler: /assembler-panel/,
    chat: /chat-panel/,
    debug: /debug-panel/,
    eval: /eval-panel/,
    components: /components-panel/,
  };
  for (const view of views) {
    const html = renderApp({ ...baseState(), view });
    for (const other of views) {
      if (other === view) {
        assert.match(html, expected[other]!, `${view} should render its own panel`);
      } else {
        assert.ok(!expected[other]!.test(html), `${view} should not render ${other}`);
      }
    }
  }
});

test("active tab carries is-active class", () => {
  const html = renderApp({ ...baseState(), view: "debug" });
  assert.match(html, /class="runtime-ui-tab is-active" data-view="debug"/);
  assert.match(html, /class="runtime-ui-tab" data-view="assembler"/);
});

test("app renders with fake data filling the active chat view", () => {
  const state: AppState = {
    ...baseState(),
    view: "chat",
    chat: { messages: [{ role: "user", content: "hi" }] },
  };
  const html = renderApp(state);

  assert.match(html, /hi/);
  assert.match(html, /chat-panel/);
});

test("app renders the components view with catalog and config form", () => {
  const state: AppState = {
    ...baseState(),
    view: "components",
    components: {
      components: [
        {
          id: "model-openai",
          version: "1.0",
          role: "model",
          description: "模型封装组件",
          inputs: [{ name: "messages", type: "MessageList" }],
          outputs: [{ name: "response", type: "string" }],
          params: {
            model: { type: "string", default: "gpt-4o-mini", enum: ["gpt-4o-mini", "gpt-4o"] },
          },
        },
      ],
      selectedId: "model-openai",
      config: { apiKey: "sk-***xyz", baseUrl: "", componentParams: {} },
      error: null,
      pending: false,
      saving: false,
      saved: false,
    },
  };
  const html = renderApp(state);

  assert.match(html, /model-openai@1\.0/);
  assert.match(html, /模型封装组件/);
  assert.match(html, /manual-title/);
  assert.match(html, /config-form/);
  // api key 掩码回显，不出现完整 key
  assert.match(html, /sk-\*\*\*xyz/);
  assert.ok(!html.includes("sk-proj-full-key"));
});
