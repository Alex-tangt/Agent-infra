import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createAssemblerServer,
  type AssemblerServerOptions,
} from "../src/server.ts";
import { PiDriver } from "../src/piDriver.ts";

const DEMO_CODE = [
  "from components.agent import Agent, register_agent",
  "from components.context import ContextWindow, register_context",
  "from components.model import OpenAIModel, register_model",
  "",
  "context_window = ContextWindow(max_rounds=5, strategy=\"truncate\")",
  "model = OpenAIModel(model=\"gpt-4o-mini\", temperature=0.7, max_tokens=1024)",
  "agent_single = Agent(model=model, context=context_window, tools=None, max_iterations=3)",
  "",
  "def run(user_message: str) -> str:",
  "    return agent_single.run(user_message)",
  "",
].join("\n");

async function withServer(
  fn: (baseUrl: string) => Promise<void>,
  options: AssemblerServerOptions = {},
): Promise<void> {
  // 默认不注入驱动 → 走 local 驱动（确定性输出 demo 代码，无模型依赖）；可按需注入 pi 驱动
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

test("POST /assemble: 明确需求 → demo 代码 + 瞬态 spec + 组装记录", async () => {
  await withServer(async (baseUrl) => {
    const res = await post(baseUrl, { requirement: "用 gpt-4o 做一个会查天气的 agent" });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    const body = (await res.json()) as {
      status: string;
      code?: string;
      spec?: Record<string, unknown> | null;
      buildNote?: Record<string, unknown>;
    };
    assert.equal(body.status, "recipe");
    assert.ok(typeof body.code === "string" && body.code.length > 0);
    assert.match(body.code!, /def run\(user_message: str\)/);
    assert.ok(body.spec && "components" in body.spec);
    assert.ok(Array.isArray(body.spec!.components));
    assert.ok(body.buildNote!.decisions);
  });
});

test("POST /assemble: 模糊需求 → 澄清问题（非代码）", async () => {
  await withServer(async (baseUrl) => {
    const res = await post(baseUrl, { requirement: "做一个带工具的 agent" });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string; questions: string[] };
    assert.equal(body.status, "clarify");
    assert.ok(body.questions.length > 0);
  });
});

test("POST /assemble: 带 answers → 澄清闭环出 demo 代码 + spec", async () => {
  await withServer(async (baseUrl) => {
    const first = await post(baseUrl, { requirement: "做一个带工具的 agent" });
    assert.equal(((await first.json()) as { status: string }).status, "clarify");

    const res = await post(baseUrl, {
      requirement: "做一个带工具的 agent",
      answers: { model: "gpt-4o", tools: ["天气"] },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      status: string;
      code?: string;
      spec?: { name?: string } | null;
    };
    assert.equal(body.status, "recipe");
    assert.ok(typeof body.code === "string" && body.code.length > 0);
    assert.equal(body.spec?.name, "weather-agent");
  });
});

test("POST /assemble: 注入 pi 驱动（mock 会话）按需可用，spec 为空", async () => {
  const driver = new PiDriver({
    createSession: async () => ({
      run: async (): Promise<string> => DEMO_CODE,
    }),
  });

  await withServer(
    async (baseUrl) => {
      const res = await post(baseUrl, { requirement: "用 gpt-4o 做一个会查天气的 agent" });

      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        status: string;
        code?: string;
        spec?: Record<string, unknown> | null;
      };
      assert.equal(body.status, "recipe");
      assert.ok(typeof body.code === "string" && body.code.length > 0);
      assert.match(body.code!, /def run\(user_message: str\)/);
      assert.equal(body.spec, null);
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
