import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AssemblerSession,
  MockAssembler,
  renderAssemblerPanel,
} from "../src/panels/assemblerPanel.ts";
import type {
  AssemblerPanelState,
  AssemblerPort,
  GenerateDemoApi,
} from "../src/panels/assemblerPanel.ts";
import type { Recipe } from "../src/api/contract.ts";
import { MockDemoApi } from "../src/mockDemoApi.ts";
import { requirementToRecipe as assembleRecipe } from "../../assembler/src/requirementToRecipe.ts";

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

function baseState(): AssemblerPanelState {
  return {
    requirement: "",
    recipe: null,
    json: "",
    error: null,
    pending: false,
    generating: false,
    demoStatus: null,
  };
}

test("assembler panel renders input forms and empty state before a recipe exists", () => {
  const html = renderAssemblerPanel(baseState());

  assert.match(html, /组装器/);
  assert.match(html, /生成配方/);
  assert.match(html, /应用配方/);
  assert.match(html, /textarea/);
  assert.match(html, /生成 demo 并运行/);
  assert.match(html, /暂无配方/);
});

test("assembler session generates a recipe through an injected assembler (mock 组装器可测)", async () => {
  const calls: string[] = [];
  const assembler: AssemblerPort = {
    requirementToRecipe: (requirement) => {
      calls.push(requirement);
      return sampleRecipe();
    },
  };
  const session = new AssemblerSession("demo-x", assembler, new MockDemoApi());
  session.setRequirement("会查天气的 agent");
  await session.generate();

  const state = session.getState();
  assert.deepEqual(calls, ["会查天气的 agent"]);
  assert.ok(state.recipe);
  assert.equal(state.recipe.name, "weather-agent");
  assert.ok(state.json.includes("weather-agent"));
  assert.equal(state.error, null);
});

test("assembler session loads a manually pasted/edited recipe json", () => {
  const session = new AssemblerSession("demo-x", new MockAssembler(), new MockDemoApi());

  session.loadJson(JSON.stringify(sampleRecipe()));

  const state = session.getState();
  assert.ok(state.recipe);
  assert.equal(state.recipe.name, "weather-agent");
  assert.deepEqual(state.recipe.components.map((c) => c.id), [
    "context-window",
    "model-openai",
    "tool-caller",
  ]);
  assert.equal(state.error, null);
});

test("assembler session rejects malformed recipe json and keeps an error", () => {
  const session = new AssemblerSession("demo-x", new MockAssembler(), new MockDemoApi());

  session.loadJson("{ not json");

  assert.equal(session.getState().recipe, null);
  assert.ok(session.getState().error);
});

test("assembler session rejects json that is not a recipe shape", () => {
  const session = new AssemblerSession("demo-x", new MockAssembler(), new MockDemoApi());

  session.loadJson(JSON.stringify({ components: "nope" }));

  assert.ok(session.getState().error);
});

test("assembler panel visualizes components, connections and parameters", () => {
  const recipe = sampleRecipe();
  const state: AssemblerPanelState = {
    ...baseState(),
    recipe,
    json: JSON.stringify(recipe, null, 2),
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

test("assembler panel escapes recipe values", () => {
  const state: AssemblerPanelState = {
    ...baseState(),
    recipe: {
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

test("assembler panel surfaces a parse error and a demo status", () => {
  const state: AssemblerPanelState = {
    ...baseState(),
    error: "配方 JSON 无效",
    demoStatus: "demo 已生成并运行（demo-x，状态 done）",
  };
  const html = renderAssemblerPanel(state);

  assert.match(html, /配方 JSON 无效/);
  assert.match(html, /demo 已生成并运行/);
});

test("assembler session sends the current recipe to the wiring engine entry", async () => {
  let captured: Recipe | undefined;
  const api: GenerateDemoApi = {
    generateDemo: async (demoId, request) => {
      captured = request.recipe;
      return { demoId, status: "done", message: "accepted" };
    },
  };
  const session = new AssemblerSession("demo-x", new MockAssembler(), api);
  session.setRequirement("会查天气的 agent");
  await session.generate();

  await session.generateDemo();

  assert.deepEqual(captured, session.getState().recipe);
  assert.ok(session.getState().demoStatus);
});

test("assembler session generates a demo through the mock wiring engine entry", async () => {
  const session = new AssemblerSession("demo-x", new MockAssembler(), new MockDemoApi());
  session.setRequirement("会查天气的 agent");
  await session.generate();

  await session.generateDemo();

  const state = session.getState();
  assert.ok(state.demoStatus);
  assert.match(state.demoStatus, /demo-x/);
});

test("assembler session ignores generate-demo while no recipe is ready", async () => {
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

test("real chain: the panel drives the assembler's requirementToRecipe (no mock)", async () => {
  const session = new AssemblerSession(
    "demo-x",
    { requirementToRecipe: (r) => assembleRecipe(r) },
    new MockDemoApi(),
  );
  session.setRequirement("我要一个会查天气的 agent");
  await session.generate();

  const recipe = session.getState().recipe;
  assert.ok(recipe);
  assert.equal(recipe.name, "weather-agent");
  const ids = recipe.components.map((c) => c.id);
  assert.ok(ids.includes("tool-caller"));
  assert.ok(ids.includes("model-openai"));
  assert.ok(ids.includes("context-window"));
});
