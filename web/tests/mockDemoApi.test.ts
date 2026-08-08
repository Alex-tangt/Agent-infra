import { test } from "node:test";
import assert from "node:assert/strict";

import { MockDemoApi } from "../src/mockDemoApi.ts";

test("mock sendChat echoes a canned reply", async () => {
  const api = new MockDemoApi();
  const res = await api.sendChat("demo-x", [{ role: "user", content: "你好" }]);

  assert.equal(res.reply.role, "assistant");
  assert.ok(res.reply.content.length > 0);
});

test("mock getTelemetry returns spans keyed by demo id", async () => {
  const api = new MockDemoApi();
  const empty = await api.getTelemetry("demo-unknown");

  assert.equal(empty.spans.length, 0);
});

test("mock triggerAblation returns a finished run with results", async () => {
  const api = new MockDemoApi();
  const res = await api.triggerAblation("demo-x", {
    variant: { kind: "swap", target: "tools", description: "换掉工具组件" },
  });

  assert.equal(res.run.status, "done");
  assert.ok(res.run.runId.length > 0);
  assert.ok(res.run.results.length >= 1);
  assert.ok(res.run.results[0]!.scores && Object.keys(res.run.results[0]!.scores).length > 0);
});

test("mock generateDemo accepts demo code and reports the demo as done", async () => {
  const api = new MockDemoApi();
  const res = await api.generateDemo("demo-x", {
    code: 'print("hello agent")\n',
  });

  assert.equal(res.demoId, "demo-x");
  assert.equal(res.status, "done");
  assert.match(res.message ?? "", /接受 demo 代码/);
  assert.match(res.message ?? "", /字符/);
});

test("mock config read/write keeps masked api key semantics", async () => {
  const api = new MockDemoApi();

  const saved = await api.updateConfig({
    apiKey: "sk-real-key",
    baseUrl: "https://api.example.com/v1",
    componentParams: { "model-openai": { model: "gpt-4o" } },
  });
  assert.equal(saved.apiKey, "sk-real-key");
  assert.equal(saved.baseUrl, "https://api.example.com/v1");
  assert.equal(saved.componentParams["model-openai"]?.model, "gpt-4o");

  // 掩码占位回传不覆盖真实 key（与 server 同一语义）
  const untouched = await api.updateConfig({ apiKey: "sk-***key" });
  assert.equal(untouched.apiKey, "sk-real-key");

  const view = await api.getConfig();
  assert.equal(view.apiKey, "sk-real-key");
});

test("mock listComponents returns the registry-aligned catalog", async () => {
  const api = new MockDemoApi();
  const res = await api.listComponents();

  const ids = res.components.map((c) => c.id).sort();
  assert.deepEqual(ids, ["agent-single", "context-window", "model-openai", "tool-caller"]);
  const model = res.components.find((c) => c.id === "model-openai")!;
  assert.equal(model.role, "model");
  assert.ok(model.description.length > 0);
  assert.ok(model.inputs.length > 0);
  assert.ok(model.outputs.length > 0);
  assert.ok(Object.keys(model.params).length > 0);
});
