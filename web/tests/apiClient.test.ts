import { test } from "node:test";
import assert from "node:assert/strict";

import { DemoApiClient } from "../src/api/apiClient.ts";

type Captured = { url: string; init: RequestInit };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function mockFetcher(captures: Captured[], response: unknown) {
  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    captures.push({ url: String(url), init: init ?? {} });
    return jsonResponse(response);
  };
}

test("sendChat POSTs JSON to /demo/{id}/chat and returns reply", async () => {
  const captures: Captured[] = [];
  const client = new DemoApiClient(
    "http://localhost:8000",
    mockFetcher(captures, { reply: { role: "assistant", content: "hello back" } }),
  );

  const reply = await client.sendChat("demo-x", [{ role: "user", content: "hi" }]);

  assert.deepEqual(reply, { reply: { role: "assistant", content: "hello back" } });
  assert.equal(captures.length, 1);
  assert.equal(captures[0]!.url, "http://localhost:8000/demo/demo-x/chat");
  assert.equal(captures[0]!.init.method, "POST");
  const headers = captures[0]!.init.headers as Record<string, string>;
  assert.equal(headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(String(captures[0]!.init.body)), {
    messages: [{ role: "user", content: "hi" }],
  });
});

test("getTelemetry GETs /demo/{id}/telemetry and returns spans", async () => {
  const captures: Captured[] = [];
  const spans = [
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
  const client = new DemoApiClient(
    "http://localhost:8000",
    mockFetcher(captures, { spans }),
  );

  const res = await client.getTelemetry("demo-x");

  assert.equal(res.spans.length, 1);
  assert.equal(res.spans[0]!.componentId, "model");
  assert.equal(captures.length, 1);
  assert.equal(captures[0]!.url, "http://localhost:8000/demo/demo-x/telemetry");
  assert.equal(captures[0]!.init.method, undefined);
});

test("triggerAblation POSTs JSON to /demo/{id}/ablations and returns run", async () => {
  const captures: Captured[] = [];
  const client = new DemoApiClient(
    "http://localhost:8000",
    mockFetcher(captures, {
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
    }),
  );

  const res = await client.triggerAblation("demo-x", {
    variant: { kind: "swap", target: "tools", description: "换掉工具组件" },
  });

  assert.equal(res.run.runId, "r1");
  assert.equal(res.run.results.length, 1);
  assert.equal(captures.length, 1);
  assert.equal(captures[0]!.url, "http://localhost:8000/demo/demo-x/ablations");
  assert.equal(captures[0]!.init.method, "POST");
  const headers = captures[0]!.init.headers as Record<string, string>;
  assert.equal(headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(String(captures[0]!.init.body)), {
    variant: { kind: "swap", target: "tools", description: "换掉工具组件" },
  });
});

test("non-ok response throws", async () => {
  const client = new DemoApiClient("http://localhost:8000", async () => {
    return new Response("boom", { status: 500 });
  });

  await assert.rejects(() => client.getTelemetry("demo-x"));
});
