import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createAssemblerServer,
  type AssemblerServerOptions,
} from "../src/server.ts";
import { PiDriver } from "../src/piDriver.ts";
import type { Recipe } from "../src/recipe.ts";

const VALID_RECIPE: Recipe = {
  name: "weather-agent",
  components: [
    { id: "context-window", version: "1.0" },
    { id: "model-openai", version: "1.0" },
    { id: "tool-caller", version: "1.0" },
  ],
  connections: [
    { from: "context-window", to: "model-openai" },
    { from: "model-openai", to: "tool-caller" },
  ],
  parameters: { "model-openai": { temperature: 0.5 } },
};

async function withServer(
  fn: (baseUrl: string) => Promise<void>,
  options: AssemblerServerOptions = {},
): Promise<void> {
  // 默认不注入驱动 → 走 local 驱动（确定性转换，无模型依赖）；可按需注入 pi 驱动
  const server = createAssemblerServer(options);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function post(baseUrl: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/assemble`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("POST /assemble: 明确需求 → 配方 + 组装记录", async () => {
  await withServer(async (baseUrl) => {
    const res = await post(baseUrl, { requirement: "用 gpt-4o 做一个会查天气的 agent" });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.status, "recipe");
    const result = body as { status: "recipe"; recipe: Record<string, unknown>; buildNote: Record<string, unknown> };
    assert.ok(result.recipe.components);
    assert.ok(result.recipe.connections);
    assert.ok(result.recipe.parameters);
    assert.ok(result.buildNote.decisions);
  });
});

test("POST /assemble: 模糊需求 → 澄清问题（非配方）", async () => {
  await withServer(async (baseUrl) => {
    const res = await post(baseUrl, { requirement: "做一个带工具的 agent" });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string; questions: string[] };
    assert.equal(body.status, "clarify");
    assert.ok(body.questions.length > 0);
  });
});

test("POST /assemble: 带 answers → 澄清闭环出配方", async () => {
  await withServer(async (baseUrl) => {
    const first = await post(baseUrl, { requirement: "做一个带工具的 agent" });
    assert.equal(((await first.json()) as { status: string }).status, "clarify");

    const res = await post(baseUrl, {
      requirement: "做一个带工具的 agent",
      answers: { model: "gpt-4o", tools: ["天气"] },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string; recipe?: { name?: string } };
    assert.equal(body.status, "recipe");
    assert.equal(body.recipe?.name, "weather-agent");
  });
});

test("POST /assemble: 注入 pi 驱动（mock 会话）按需可用", async () => {
  const driver = new PiDriver({
    createSession: async () => ({
      run: async (): Promise<Recipe> => structuredClone(VALID_RECIPE) as Recipe,
    }),
  });

  await withServer(
    async (baseUrl) => {
      const res = await post(baseUrl, { requirement: "用 gpt-4o 做一个会查天气的 agent" });

      assert.equal(res.status, 200);
      const body = (await res.json()) as { status: string; recipe?: { name?: string } };
      assert.equal(body.status, "recipe");
      assert.equal(body.recipe?.name, "weather-agent");
    },
    { deps: { driver } },
  );
});

test("POST /assemble: 缺 requirement → 400", async () => {
  await withServer(async (baseUrl) => {
    const res = await post(baseUrl, {});
    assert.equal(res.status, 400);
  });
});

test("POST /assemble: 非 JSON 请求体 → 400", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/assemble`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    assert.equal(res.status, 400);
  });
});

test("OPTIONS 预检返回 CORS 头（web 跨域调用）", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/assemble`, { method: "OPTIONS" });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.equal(res.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");
  });
});

test("未知路径 → 404", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/nope`);
    assert.equal(res.status, 404);
  });
});
