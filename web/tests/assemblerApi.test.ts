import { test } from "node:test";
import assert from "node:assert/strict";

import { AssemblerApiClient } from "../src/api/assemblerApi.ts";

type Captured = { url: string; init: RequestInit };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockFetcher(response: unknown, captures: Captured[] = []) {
  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    captures.push({ url: String(url), init: init ?? {} });
    return jsonResponse(response);
  };
}

const RECIPE = {
  name: "weather-agent",
  components: [
    { id: "context-window", version: "1.0" },
    { id: "model-openai", version: "1.0" },
  ],
  connections: [{ from: "context-window", to: "model-openai" }],
  parameters: {},
};

test("assemblerApi: assemble POSTs the requirement to /assemble and returns a recipe", async () => {
  const captures: Captured[] = [];
  const client = new AssemblerApiClient(
    "http://localhost:9001",
    mockFetcher({ status: "recipe", recipe: RECIPE }, captures),
  );

  const outcome = await client.assemble("会查天气的 agent");

  assert.deepEqual(outcome, { status: "recipe", recipe: RECIPE });
  assert.equal(captures.length, 1);
  assert.equal(captures[0]!.url, "http://localhost:9001/assemble");
  assert.equal(captures[0]!.init.method, "POST");
  const headers = captures[0]!.init.headers as Record<string, string>;
  assert.equal(headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(String(captures[0]!.init.body)), {
    requirement: "会查天气的 agent",
  });
});

test("assemblerApi: assembleWithAnswers includes the answers in the request body", async () => {
  const captures: Captured[] = [];
  const client = new AssemblerApiClient(
    "http://localhost:9001",
    mockFetcher({ status: "recipe", recipe: RECIPE }, captures),
  );

  const outcome = await client.assembleWithAnswers("带工具的 agent", {
    model: "gpt-4o",
    tools: ["天气"],
  });

  assert.equal(outcome.status, "recipe");
  assert.deepEqual(JSON.parse(String(captures[0]!.init.body)), {
    requirement: "带工具的 agent",
    answers: { model: "gpt-4o", tools: ["天气"] },
  });
});

test("assemblerApi: a clarify response surfaces the questions", async () => {
  const client = new AssemblerApiClient(
    "http://localhost:9001",
    mockFetcher({ status: "clarify", questions: ["选哪个模型？"] }),
  );

  const outcome = await client.assemble("用哪个模型做 agent");

  assert.deepEqual(outcome, {
    status: "clarify",
    questions: ["选哪个模型？"],
  });
});

test("assemblerApi: non-ok response throws", async () => {
  const client = new AssemblerApiClient(
    "http://localhost:9001",
    async () => new Response("boom", { status: 500 }),
  );

  await assert.rejects(() => client.assemble("会查天气的 agent"), /failed: 500/);
});

test("assemblerApi: trailing slash in the base url is normalized", async () => {
  const captures: Captured[] = [];
  const client = new AssemblerApiClient(
    "http://localhost:9001/",
    mockFetcher({ status: "clarify", questions: [] }, captures),
  );

  await client.assemble("会查天气的 agent");

  assert.equal(captures[0]!.url, "http://localhost:9001/assemble");
});
