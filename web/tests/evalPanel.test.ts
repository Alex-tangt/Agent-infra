import { test } from "node:test";
import assert from "node:assert/strict";

import { renderEvalPanel } from "../src/panels/evalPanel.ts";
import type { EvalPanelState } from "../src/panels/evalPanel.ts";

test("eval panel shows ablation trigger and empty result slot", () => {
  const state: EvalPanelState = { run: null };
  const html = renderEvalPanel(state);

  assert.match(html, /评估/);
  assert.match(html, /触发消融/);
  assert.match(html, /暂无结果/);
});

test("eval panel renders ablation results with scores", () => {
  const state: EvalPanelState = {
    run: {
      runId: "r1",
      status: "done",
      results: [
        {
          variant: { kind: "swap", target: "tools", description: "换掉工具组件" },
          scores: { quality: 0.8 },
          spans: [],
        },
        {
          variant: { kind: "override", target: "temperature", description: "调低温度" },
          scores: { quality: 0.6 },
          spans: [],
        },
      ],
    },
  };
  const html = renderEvalPanel(state);

  assert.match(html, /换掉工具组件/);
  assert.match(html, /调低温度/);
  assert.match(html, /0.8/);
  assert.match(html, /0.6/);
});
