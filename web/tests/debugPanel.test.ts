import { test } from "node:test";
import assert from "node:assert/strict";

import { aggregateTelemetry, renderDebugPanel } from "../src/panels/debugPanel.ts";
import type { DebugPanelState } from "../src/panels/debugPanel.ts";
import type { TelemetrySpan } from "../src/api/contract.ts";
import { MockDemoApi } from "../src/mockDemoApi.ts";

test("debug panel renders empty state when no spans", () => {
  const state: DebugPanelState = { spans: [] };
  const html = renderDebugPanel(state);

  assert.match(html, /调试\/监测|调试/);
  assert.match(html, /暂无遥测/);
});

test("debug panel lists spans with component, duration, tokens", () => {
  const spans: TelemetrySpan[] = [
    {
      id: "s1",
      componentId: "model",
      operation: "chat",
      startTimeMs: 1000,
      durationMs: 42,
      tokenUsage: { input: 10, output: 5 },
      status: "ok",
    },
  ];
  const state: DebugPanelState = { spans };
  const html = renderDebugPanel(state);

  assert.match(html, /model/);
  assert.match(html, /42/);
  assert.match(html, /10/);
  assert.match(html, /5/);
});

test("debug panel escapes component id", () => {
  const spans: TelemetrySpan[] = [
    {
      id: "s1",
      componentId: "<script>bad</script>",
      operation: "op",
      startTimeMs: 0,
      durationMs: 1,
      tokenUsage: null,
      status: "ok",
    },
  ];
  const state: DebugPanelState = { spans };
  const html = renderDebugPanel(state);

  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;script&gt;/);
});

test("aggregateTelemetry sums duration, calls and tokens per component", () => {
  const spans: TelemetrySpan[] = [
    {
      id: "s1",
      componentId: "model",
      operation: "chat",
      startTimeMs: 0,
      durationMs: 100,
      tokenUsage: { input: 10, output: 5 },
      status: "ok",
    },
    {
      id: "s2",
      componentId: "model",
      operation: "chat",
      startTimeMs: 0,
      durationMs: 50,
      tokenUsage: { input: 20, output: 15 },
      status: "ok",
    },
    {
      id: "s3",
      componentId: "tools",
      operation: "search",
      startTimeMs: 0,
      durationMs: 30,
      tokenUsage: null,
      status: "ok",
    },
  ];

  const rows = aggregateTelemetry(spans);

  assert.equal(rows.length, 2);
  const model = rows.find((r) => r.componentId === "model");
  assert.ok(model);
  assert.equal(model.callCount, 2);
  assert.equal(model.totalDurationMs, 150);
  assert.deepEqual(model.tokens, { input: 30, output: 20 });
  assert.deepEqual(model.operations, ["chat"]);
  const tools = rows.find((r) => r.componentId === "tools");
  assert.ok(tools);
  assert.equal(tools.callCount, 1);
  assert.equal(tools.totalDurationMs, 30);
  assert.equal(tools.tokens, null);
});

test("debug panel renders one aggregated row per component", () => {
  const spans: TelemetrySpan[] = [
    {
      id: "s1",
      componentId: "model",
      operation: "chat",
      startTimeMs: 0,
      durationMs: 100,
      tokenUsage: { input: 10, output: 5 },
      status: "ok",
    },
    {
      id: "s2",
      componentId: "model",
      operation: "chat",
      startTimeMs: 0,
      durationMs: 50,
      tokenUsage: { input: 20, output: 15 },
      status: "ok",
    },
  ];
  const html = renderDebugPanel({ spans });

  assert.match(html, /data-component-id="model"/);
  assert.match(html, /class="component-calls">2<\/td>/);
  assert.match(html, /150ms/);
  assert.match(html, /data-gen-ai-usage-input-tokens="30"/);
  assert.match(html, /data-gen-ai-usage-output-tokens="20"/);
});

test("debug panel exposes OTel GenAI semconv fields per row", () => {
  const spans: TelemetrySpan[] = [
    {
      id: "s1",
      componentId: "model",
      operation: "chat",
      startTimeMs: 0,
      durationMs: 42,
      tokenUsage: { input: 12, output: 7 },
      status: "ok",
    },
  ];
  const html = renderDebugPanel({ spans });

  assert.match(html, /data-gen-ai-operation-name="chat"/);
  assert.match(html, /data-gen-ai-usage-input-tokens="12"/);
  assert.match(html, /data-gen-ai-usage-output-tokens="7"/);
});

test("debug panel renders mock demo telemetry without a real backend", async () => {
  const api = new MockDemoApi();
  api.setTelemetry("demo-x", {
    spans: [
      {
        id: "s1",
        componentId: "model",
        operation: "chat",
        startTimeMs: 0,
        durationMs: 120,
        tokenUsage: { input: 512, output: 128 },
        status: "ok",
      },
      {
        id: "s2",
        componentId: "tools",
        operation: "search",
        startTimeMs: 0,
        durationMs: 34,
        tokenUsage: null,
        status: "ok",
      },
    ],
  });

  const { spans } = await api.getTelemetry("demo-x");
  const html = renderDebugPanel({ spans });

  assert.match(html, /data-component-id="model"/);
  assert.match(html, /data-component-id="tools"/);
  assert.match(html, /120ms/);
  assert.match(html, /512/);
  assert.match(html, /128/);
});
