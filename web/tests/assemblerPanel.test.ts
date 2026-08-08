import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AssemblerSession,
  MockAssembler,
  renderAssemblerPanel,
} from "../src/panels/assemblerPanel.ts";
import type {
  AssemblerPanelState,
  GenerateDemoApi,
} from "../src/panels/assemblerPanel.ts";
import type { AssemblerPort, BuildNote } from "../src/api/assemblerContract.ts";
import type { Recipe } from "../src/api/contract.ts";
import { MockDemoApi } from "../src/mockDemoApi.ts";
import { AssemblerApiClient } from "../src/api/assemblerApi.ts";

function sampleRecipe(): Recipe {
  return {
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
    parameters: { "model-openai": { model: "gpt-4o", temperature: 0.5 } },
  };
}

function sampleCode(): string {
  return '# 会查天气的 agent\ndef run(user_message: str) -> str:\n    return "天气晴"';
}

function sampleBuildNote(): BuildNote {
  return {
    requirement: "会查天气的 agent",
    skillUsed: null,
    decisions: [],
    notes: [],
  };
}

function baseState(): AssemblerPanelState {
  return {
    requirement: "",
    questions: null,
    code: "",
    spec: null,
    error: null,
    pending: false,
    generating: false,
    demoStatus: null,
  };
}

test("assembler panel renders input forms and empty state before any code exists", () => {
  const html = renderAssemblerPanel(baseState());

  assert.match(html, /组装器/);
  assert.match(html, /生成 demo 代码/);
  assert.match(html, /应用代码/);
  assert.match(html, /textarea/);
  assert.match(html, /生成 demo 并运行/);
  assert.match(html, /暂无 spec/);
});

test("assembler session generates demo code through an injected assembler (mock 组装器可测)", async () => {
  const calls: string[] = [];
  const assembler: AssemblerPort = {
    assemble: async (requirement) => {
      calls.push(requirement);
      return {
        status: "recipe",
        code: sampleCode(),
        spec: sampleRecipe(),
        buildNote: sampleBuildNote(),
      };
    },
    assembleWithAnswers: async (requirement) => {
      calls.push(requirement);
      return {
        status: "recipe",
        code: sampleCode(),
        spec: sampleRecipe(),
        buildNote: sampleBuildNote(),
      };
    },
  };
  const session = new AssemblerSession("demo-x", assembler, new MockDemoApi());
  session.setRequirement("会查天气的 agent");
  await session.generate();

  const state = session.getState();
  assert.deepEqual(calls, ["会查天气的 agent"]);
  assert.ok(state.code.includes("def run"));
  assert.equal(state.spec?.name, "weather-agent");
  assert.equal(state.error, null);
});

test("assembler session loads manually pasted/edited demo code", () => {
  const session = new AssemblerSession("demo-x", new MockAssembler(), new MockDemoApi());

  session.loadCode(sampleCode());

  const state = session.getState();
  assert.equal(state.code, sampleCode());
  assert.equal(state.error, null);
});

test("assembler session accepts arbitrary code text without structural validation", () => {
  const session = new AssemblerSession("demo-x", new MockAssembler(), new MockDemoApi());

  session.loadCode("# 代码是真相源，不做结构校验，甚至不是合法 Python 也照单全收");
  session.loadCode("{ not json");

  assert.equal(session.getState().code, "{ not json");
  assert.equal(session.getState().error, null);
});

test("assembler panel visualizes the spec components, connections and parameters", () => {
  const spec = sampleRecipe();
  const state: AssemblerPanelState = {
    ...baseState(),
    code: sampleCode(),
    spec,
  };
  const html = renderAssemblerPanel(state);

  assert.match(html, /context-window/);
  assert.match(html, /model-openai/);
  assert.match(html, /tool-caller/);
  assert.match(html, /context-window → model-openai/);
  assert.match(html, /model-openai → tool-caller/);
  assert.match(html, /gpt-4o/);
  assert.match(html, /temperature=0.5/);
});

test("assembler panel escapes spec values", () => {
  const state: AssemblerPanelState = {
    ...baseState(),
    code: "# code",
    spec: {
      name: "x",
      components: [{ id: "<script>bad</script>", version: "1.0" }],
      connections: [],
      parameters: {},
    },
  };
  const html = renderAssemblerPanel(state);

  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;script&gt;/);
});

test("assembler panel surfaces an error and a demo status", () => {
  const state: AssemblerPanelState = {
    ...baseState(),
    error: "demo 代码校验未通过",
    demoStatus: "demo 已生成并运行（demo-x，状态 done）",
  };
  const html = renderAssemblerPanel(state);

  assert.match(html, /demo 代码校验未通过/);
  assert.match(html, /demo 已生成并运行/);
});

test("assembler session sends the current code to the runtime entry", async () => {
  let captured: string | undefined;
  const api: GenerateDemoApi = {
    generateDemo: async (demoId, request) => {
      captured = request.code;
      return { demoId, status: "done", message: "accepted" };
    },
  };
  const assembler: AssemblerPort = {
    assemble: async () => ({
      status: "recipe",
      code: sampleCode(),
      spec: sampleRecipe(),
      buildNote: sampleBuildNote(),
    }),
    assembleWithAnswers: async () => ({
      status: "recipe",
      code: sampleCode(),
      spec: sampleRecipe(),
      buildNote: sampleBuildNote(),
    }),
  };
  const session = new AssemblerSession("demo-x", assembler, api);
  session.setRequirement("会查天气的 agent");
  await session.generate();

  await session.generateDemo();

  assert.deepEqual(captured, session.getState().code);
  assert.ok(session.getState().demoStatus);
});

test("assembler session generates a demo through the mock runtime entry", async () => {
  const session = new AssemblerSession("demo-x", new MockAssembler(), new MockDemoApi());
  session.setRequirement("会查天气的 agent");
  await session.generate();

  await session.generateDemo();

  const state = session.getState();
  assert.ok(state.demoStatus);
  assert.match(state.demoStatus, /demo-x/);
});

test("assembler session ignores generate-demo while no code is ready", async () => {
  let calls = 0;
  const api: GenerateDemoApi = {
    generateDemo: async (demoId) => {
      calls += 1;
      return { demoId, status: "done" };
    },
  };
  const session = new AssemblerSession("demo-x", new MockAssembler(), api);

  await session.generateDemo();

  assert.equal(calls, 0);
  assert.equal(session.getState().demoStatus, null);
});

// real chain: 面板经 HTTP 客户端（AssemblerApiClient）驱动组装器服务走真实"需求→demo 代码"链路
test("real chain: the panel drives the assembler service over HTTP (no mock)", async () => {
  const fetcher = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    assert.equal(String(url), "http://localhost:9001/assemble");
    const body = JSON.parse(String(init?.body)) as { requirement: string };
    const spec = sampleRecipe();
    spec.name = "weather-agent";
    return new Response(
      JSON.stringify({
        status: "recipe",
        code: sampleCode(),
        spec,
        buildNote: sampleBuildNote(),
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };
  const session = new AssemblerSession(
    "demo-x",
    new AssemblerApiClient("http://localhost:9001", fetcher),
    new MockDemoApi(),
  );
  session.setRequirement("我要一个会查天气的 agent");
  await session.generate();

  const state = session.getState();
  assert.ok(state.code.includes("def run"));
  const spec = state.spec;
  assert.ok(spec);
  const ids = spec.components.map((c) => c.id);
  assert.ok(ids.includes("tool-caller"));
  assert.ok(ids.includes("model-openai"));
  assert.ok(ids.includes("context-window"));
});

// 澄清机制接入：needsClarification 返回问题 → 界面展示 → 用户回答 → 带 answers 再次调用
test("assembler session surfaces clarification questions and answers into demo code", async () => {
  const requests: unknown[] = [];
  const fetcher = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as { requirement: string; answers?: unknown };
    requests.push(body);
    const outcome =
      body.answers === undefined
        ? { status: "clarify", questions: ["选哪个模型？", "需要哪些工具？"] }
        : {
            status: "recipe",
            code: sampleCode(),
            spec: sampleRecipe(),
            buildNote: sampleBuildNote(),
          };
    return new Response(JSON.stringify(outcome), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const session = new AssemblerSession(
    "demo-x",
    new AssemblerApiClient("http://localhost:9001", fetcher),
    new MockDemoApi(),
  );
  session.setRequirement("做一个带工具的 agent");

  await session.generate();
  const clarified = session.getState();
  assert.equal(clarified.code, "");
  assert.equal(clarified.spec, null);
  assert.deepEqual(clarified.questions, ["选哪个模型？", "需要哪些工具？"]);

  const html = renderAssemblerPanel(clarified);
  assert.match(html, /选哪个模型/);
  assert.match(html, /assembler-answers/);
  assert.match(html, /提交答案/);

  await session.answer({ model: "gpt-4o", tools: ["天气"] });
  const done = session.getState();
  assert.equal(done.questions, null);
  assert.ok(done.code.includes("def run"));
  assert.equal(done.spec?.name, "weather-agent");
  assert.deepEqual(requests, [
    { requirement: "做一个带工具的 agent" },
    {
      requirement: "做一个带工具的 agent",
      answers: { model: "gpt-4o", tools: ["天气"] },
    },
  ]);
});

test("assembler session reports an http failure as a panel error", async () => {
  const session = new AssemblerSession(
    "demo-x",
    new AssemblerApiClient("http://localhost:9001", async () => new Response("boom", { status: 500 })),
    new MockDemoApi(),
  );
  session.setRequirement("会查天气的 agent");
  await session.generate();

  const state = session.getState();
  assert.equal(state.code, "");
  assert.equal(state.spec, null);
  assert.match(state.error ?? "", /failed: 500/);
});
