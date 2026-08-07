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

test("mock generateDemo accepts a recipe and reports the demo as done", async () => {
  const api = new MockDemoApi();
  const res = await api.generateDemo("demo-x", {
    recipe: {
      name: "weather-agent",
      components: [
        { id: "context-window", version: "1.0" },
        { id: "model-openai", version: "1.0" },
      ],
      connections: [{ from: "context-window", to: "model-openai" }],
      parameters: {},
    },
  });

  assert.equal(res.demoId, "demo-x");
  assert.equal(res.status, "done");
  assert.match(res.message ?? "", /接受配方/);
});
