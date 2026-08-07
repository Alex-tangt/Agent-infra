import { test } from "node:test";
import assert from "node:assert/strict";

import { EvalSession, renderEvalPanel } from "../src/panels/evalPanel.ts";
import type { EvalPanelState, EvalApi } from "../src/panels/evalPanel.ts";
import type { AblationResponse } from "../src/api/contract.ts";
import { MockDemoApi } from "../src/mockDemoApi.ts";

test("eval panel disables the trigger form while a run is pending", () => {
  const html = renderEvalPanel({ run: null, pending: true });

  assert.match(html, /disabled/);
});

test("eval session exposes pending and ignores re-entrant starts", async () => {
  let resolveRun!: (res: AblationResponse) => void;
  const api: EvalApi = {
    triggerAblation: () =>
      new Promise<AblationResponse>((resolve) => {
        resolveRun = resolve;
      }),
  };
  const session = new EvalSession("demo-x", api);

  const inFlight = session.startRun({
    kind: "remove",
    target: "memory",
    description: "删掉记忆组件",
  });

  assert.equal(session.getState().pending, true);

  resolveRun({ run: { runId: "r9", status: "done", results: [] } });
  await inFlight;

  assert.equal(session.getState().pending, false);
  assert.equal(session.getState().run?.runId, "r9");
});

test("eval session triggers ablation via mock runner and stores the run", async () => {
  const api = new MockDemoApi();
  const session = new EvalSession("demo-x", api);

  await session.startRun({ kind: "swap", target: "tools", description: "换掉工具组件" });

  const state = session.getState();
  assert.ok(state.run);
  assert.equal(state.run.status, "done");
  assert.ok(state.run.results.length >= 1);
  assert.deepEqual(state.run.results[0]!.variant, {
    kind: "swap",
    target: "tools",
    description: "换掉工具组件",
  });
});

test("eval panel shows ablation trigger and empty result slot", () => {
  const state: EvalPanelState = { run: null };
  const html = renderEvalPanel(state);

  assert.match(html, /评估/);
  assert.match(html, /触发消融/);
  assert.match(html, /暂无结果/);
});

test("eval panel offers ablation variant selection form", () => {
  const html = renderEvalPanel({ run: null });

  assert.match(html, /name="kind"/);
  for (const kind of ["swap", "remove", "override"]) {
    assert.match(html, new RegExp(`value="${kind}"`));
  }
  assert.match(html, /name="target"/);
  assert.match(html, /name="description"/);
  assert.match(html, /type="submit"/);
});

test("eval panel renders variants side by side with scores and span summary", () => {
  const state: EvalPanelState = {
    run: {
      runId: "r1",
      status: "done",
      results: [
        {
          variant: { kind: "swap", target: "tools", description: "换掉工具组件" },
          scores: { quality: 0.8, latency: 0.7 },
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
          ],
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

  const first = html.indexOf("换掉工具组件");
  const second = html.indexOf("调低温度");
  assert.ok(first >= 0 && second > first);
  assert.match(html, /quality=0.8/);
  assert.match(html, /quality=0.6/);
  assert.match(html, /latency=0.7/);
  assert.match(html, /spans: 1/);
  assert.match(html, /model/);
  assert.match(html, /spans: 0/);
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
