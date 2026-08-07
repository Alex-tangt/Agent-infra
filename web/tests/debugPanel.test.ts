import { test } from "node:test";
import assert from "node:assert/strict";

import { renderDebugPanel } from "../src/panels/debugPanel.ts";
import type { DebugPanelState } from "../src/panels/debugPanel.ts";
import type { TelemetrySpan } from "../src/api/contract.ts";

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
