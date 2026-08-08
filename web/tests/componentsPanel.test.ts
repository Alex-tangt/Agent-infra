import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ComponentsSession,
  parseParamValue,
  parseParamValues,
  renderComponentsPanel,
} from "../src/panels/componentsPanel.ts";
import type { ComponentsPanelState } from "../src/panels/componentsPanel.ts";
import type { ComponentInfo } from "../src/api/contract.ts";
import { MockDemoApi } from "../src/mockDemoApi.ts";

const MODEL_COMPONENT: ComponentInfo = {
  id: "model-openai",
  version: "1.0",
  role: "model",
  description: "OpenAI 兼容大模型封装组件",
  inputs: [{ name: "messages", type: "MessageList" }],
  outputs: [{ name: "response", type: "string" }],
  params: {
    model: { type: "string", default: "gpt-4o-mini", enum: ["gpt-4o-mini", "gpt-4o"] },
    temperature: { type: "number", default: 0.7, min: 0, max: 2 },
  },
};

function baseState(): ComponentsPanelState {
  return {
    components: [],
    selectedId: null,
    config: null,
    error: null,
    pending: false,
    saving: false,
    saved: false,
  };
}

// --- ComponentsSession：拉取目录/配置、选中、保存默认设置 ---

test("session load fetches catalog and config, auto-selects first component", async () => {
  const api = new MockDemoApi();
  await api.updateConfig({ apiKey: "sk-real-key", baseUrl: "https://api.example.com/v1" });
  const session = new ComponentsSession(api);

  await session.load();

  const state = session.getState();
  assert.equal(state.components.length, 4);
  assert.equal(state.components[0]!.id, "model-openai");
  assert.equal(state.selectedId, "model-openai");
  assert.equal(state.config?.apiKey, "sk-real-key");
  assert.equal(state.config?.baseUrl, "https://api.example.com/v1");
});

test("session select switches the active component", async () => {
  const session = new ComponentsSession(new MockDemoApi());
  await session.load();
  session.select("context-window");
  assert.equal(session.getState().selectedId, "context-window");
});

test("session saveConfig persists defaults and reports saved", async () => {
  const session = new ComponentsSession(new MockDemoApi());
  await session.load();

  await session.saveConfig({
    apiKey: "sk-***xyz", // 掩码占位：不覆盖真实 key
    componentParams: { "model-openai": { temperature: 0.2 } },
  });

  const state = session.getState();
  assert.equal(state.saved, true);
  assert.equal(state.error, null);
  // 掩码占位未改动 api key（mock 与 server 同一语义）
  assert.equal(state.config?.apiKey, "");
  assert.equal(state.config?.componentParams["model-openai"]?.temperature, 0.2);
});

test("session saveConfig surfaces api errors", async () => {
  const api = new MockDemoApi();
  const session = new ComponentsSession(api);
  await session.load();
  const original = api.updateConfig.bind(api);
  api.updateConfig = async () => {
    throw new Error("server 不可达");
  };
  try {
    await session.saveConfig({ baseUrl: "https://x" });
    assert.equal(session.getState().saved, false);
    assert.match(session.getState().error ?? "", /server 不可达/);
  } finally {
    api.updateConfig = original;
  }
});

// --- 渲染：目录 / 说明书 / 默认设置编辑 ---

test("panel renders catalog with id@version, role and description", () => {
  const state: ComponentsPanelState = {
    ...baseState(),
    components: [MODEL_COMPONENT],
  };
  const html = renderComponentsPanel(state);

  assert.match(html, /组件库/);
  assert.match(html, /model-openai@1\.0/);
  assert.match(html, /data-role="model"/);
  assert.match(html, /OpenAI 兼容大模型封装组件/);
});

test("panel renders manual with inputs, outputs and params for selected component", () => {
  const state: ComponentsPanelState = {
    ...baseState(),
    components: [MODEL_COMPONENT],
    selectedId: "model-openai",
  };
  const html = renderComponentsPanel(state);

  assert.match(html, /manual-title/);
  assert.match(html, /messages : MessageList/);
  assert.match(html, /response : string/);
  assert.match(html, /data-param-name="temperature"/);
  assert.match(html, /data-param-name="model"/);
  assert.match(html, /enum=\[gpt-4o-mini, gpt-4o\]/);
});

test("panel renders config form with masked api key and saved default values", () => {
  const state: ComponentsPanelState = {
    ...baseState(),
    components: [MODEL_COMPONENT],
    selectedId: "model-openai",
    config: {
      apiKey: "sk-***abc",
      baseUrl: "https://api.example.com/v1",
      componentParams: { "model-openai": { temperature: 0.2 } },
    },
  };
  const html = renderComponentsPanel(state);

  // api key 掩码回显；完整 key 绝不出现在 DOM
  assert.match(html, /sk-\*\*\*abc/);
  assert.ok(!html.includes("sk-secret-full-key"));
  assert.match(html, /https:\/\/api\.example\.com\/v1/);
  // 已保存的默认值回填到输入框
  assert.match(html, /value="0\.2"/);
  assert.match(html, /data-param="model"/);
});

test("panel shows saved feedback after saving", () => {
  const state: ComponentsPanelState = {
    ...baseState(),
    saved: true,
  };
  const html = renderComponentsPanel(state);
  assert.match(html, /data-config-status="saved"/);
  assert.match(html, /已保存/);
});

// --- 参数解析：按参数契约把表单字符串转成结构化值 ---

test("parseParamValue parses numbers and keeps strings", () => {
  assert.equal(parseParamValue("0.7", MODEL_COMPONENT.params["temperature"]!), 0.7);
  assert.equal(parseParamValue("gpt-4o", MODEL_COMPONENT.params["model"]!), "gpt-4o");
  assert.equal(parseParamValue("5", { type: "integer" }), 5);
  assert.equal(parseParamValue("5", { type: "string" }), "5");
  assert.equal(parseParamValue("", { type: "number" }), "");
});

test("parseParamValues maps raw form values through the contract", () => {
  const raw = { model: "gpt-4o", temperature: "0.2", unknown: "keep" };
  const params = parseParamValues(raw, MODEL_COMPONENT);
  assert.deepEqual(params, { model: "gpt-4o", temperature: 0.2, unknown: "keep" });
});
