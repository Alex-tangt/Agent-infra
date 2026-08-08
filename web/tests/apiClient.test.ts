import { test } from "node:test";
import assert from "node:assert/strict";

import { DemoApiClient } from "../src/api/apiClient.ts";
import type { DemoApi } from "../src/mockDemoApi.ts";

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

test("generateDemo POSTs the recipe to /demo/{id}/generate", async () => {
  const captures: Captured[] = [];
  const recipe = {
    name: "weather-agent",
    components: [
      { id: "context-window", version: "1.0" },
      { id: "model-openai", version: "1.0" },
    ],
    connections: [{ from: "context-window", to: "model-openai" }],
    parameters: {},
  };
  const client = new DemoApiClient(
    "http://localhost:8000",
    mockFetcher(captures, { demoId: "demo-x", status: "done" }),
  );

  const res = await client.generateDemo("demo-x", { recipe });

  assert.equal(res.status, "done");
  assert.equal(captures.length, 1);
  assert.equal(captures[0]!.url, "http://localhost:8000/demo/demo-x/generate");
  assert.equal(captures[0]!.init.method, "POST");
  assert.deepEqual(JSON.parse(String(captures[0]!.init.body)), { recipe });
});

test("non-ok response throws", async () => {
  const client = new DemoApiClient("http://localhost:8000", async () => {
    return new Response("boom", { status: 500 });
  });

  await assert.rejects(() => client.getTelemetry("demo-x"));
});

test("getConfig GETs /config and returns the masked config view", async () => {
  const captures: Captured[] = [];
  const client = new DemoApiClient(
    "http://localhost:8000",
    mockFetcher(captures, {
      apiKey: "sk-***abc",
      baseUrl: "https://api.example.com/v1",
      componentParams: { "model-openai": { model: "gpt-4o" } },
    }),
  );

  const res = await client.getConfig();

  assert.equal(res.apiKey, "sk-***abc");
  assert.equal(res.baseUrl, "https://api.example.com/v1");
  assert.equal(res.componentParams["model-openai"]?.model, "gpt-4o");
  assert.equal(captures.length, 1);
  assert.equal(captures[0]!.url, "http://localhost:8000/config");
  assert.equal(captures[0]!.init.method, undefined);
});

test("updateConfig PUTs JSON to /config", async () => {
  const captures: Captured[] = [];
  const client = new DemoApiClient(
    "http://localhost:8000",
    mockFetcher(captures, {
      apiKey: "sk-***abc",
      baseUrl: "",
      componentParams: {},
    }),
  );

  const res = await client.updateConfig({ apiKey: "sk-***abc" });

  assert.equal(res.apiKey, "sk-***abc");
  assert.equal(captures.length, 1);
  assert.equal(captures[0]!.url, "http://localhost:8000/config");
  assert.equal(captures[0]!.init.method, "PUT");
  assert.deepEqual(JSON.parse(String(captures[0]!.init.body)), { apiKey: "sk-***abc" });
});

test("listComponents GETs /components and returns the registry contracts", async () => {
  const captures: Captured[] = [];
  const client = new DemoApiClient(
    "http://localhost:8000",
    mockFetcher(captures, {
      components: [
        {
          id: "model-openai",
          version: "1.0",
          role: "model",
          description: "模型封装",
          inputs: [{ name: "messages", type: "MessageList" }],
          outputs: [{ name: "response", type: "string" }],
          params: { model: { type: "string", default: "gpt-4o-mini" } },
        },
      ],
    }),
  );

  const res = await client.listComponents();

  assert.equal(res.components.length, 1);
  assert.equal(res.components[0]!.id, "model-openai");
  assert.equal(res.components[0]!.params.model?.default, "gpt-4o-mini");
  assert.equal(captures.length, 1);
  assert.equal(captures[0]!.url, "http://localhost:8000/components");
  assert.equal(captures[0]!.init.method, undefined);
});

test("DemoApiClient satisfies the DemoApi seam (OTel-backed backend drops in)", () => {
  const client: DemoApi = new DemoApiClient("http://localhost:8000");

  assert.equal(typeof client.sendChat, "function");
  assert.equal(typeof client.getTelemetry, "function");
  assert.equal(typeof client.triggerAblation, "function");
  assert.equal(typeof client.generateDemo, "function");
  assert.equal(typeof client.getConfig, "function");
  assert.equal(typeof client.updateConfig, "function");
  assert.equal(typeof client.listComponents, "function");
});
