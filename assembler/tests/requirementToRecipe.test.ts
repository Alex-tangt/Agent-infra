import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CATALOG,
  type ComponentCatalog,
} from "../src/catalog.ts";
import { requirementToRecipe } from "../src/requirementToRecipe.ts";
import { validateStructure } from "../src/schema.ts";

test("conversion: a weather requirement yields a schema-valid recipe with tools", () => {
  const recipe = requirementToRecipe("我要一个会查天气的 agent", DEFAULT_CATALOG);

  assert.doesNotThrow(() => validateStructure(recipe));
  assert.equal(recipe.name, "weather-agent");
  const ids = recipe.components.map((c) => c.id);
  assert.ok(ids.includes("model-openai"));
  assert.ok(ids.includes("context-window"));
  assert.ok(ids.includes("tool-caller"));
});

test("conversion: every referenced component exists in the injected catalog", () => {
  const recipe = requirementToRecipe("做一个能搜索的助手", DEFAULT_CATALOG);

  for (const component of recipe.components) {
    const entry = DEFAULT_CATALOG.components.find(
      (c) => c.id === component.id && c.version === component.version,
    );
    assert.ok(entry, `component ${component.id}@${component.version} not in catalog`);
  }
  for (const connection of recipe.connections) {
    const ids = recipe.components.map((c) => c.id);
    assert.ok(ids.includes(connection.from), `connection from ${connection.from}`);
    assert.ok(ids.includes(connection.to), `connection to ${connection.to}`);
  }
});

test("conversion: a plain chat requirement keeps the base single-agent core", () => {
  const recipe = requirementToRecipe("帮我做个能对话的聊天机器人", DEFAULT_CATALOG);

  const ids = recipe.components.map((c) => c.id);
  assert.ok(ids.includes("model-openai"));
  assert.ok(ids.includes("context-window"));
  assert.equal(ids.includes("tool-caller"), false);
});

test("conversion: agent requirement wires every part into agent-single (composition edge)", () => {
  const recipe = requirementToRecipe("会搜索的聊天 agent", DEFAULT_CATALOG);

  const agentTargets = recipe.connections.filter((c) => c.to === "agent-single");
  assert.ok(agentTargets.length >= 1, "agent-single should have incoming connections");
  const sourceIds = agentTargets.map((c) => c.from).sort();
  const partIds = recipe.components
    .map((c) => c.id)
    .filter((id) => id !== "agent-single")
    .sort();
  assert.deepEqual(sourceIds, partIds, "every part must wire into agent-single");
  const serialEdges = recipe.connections.filter((c) => c.to !== "agent-single");
  assert.equal(serialEdges.length, 0, "agent composition should not leave serial edges");
});

test("conversion: model hint in the requirement becomes a param override", () => {
  const recipe = requirementToRecipe("用 gpt-4o 做一个聊天助手", DEFAULT_CATALOG);

  assert.deepEqual(recipe.parameters["model-openai"], { model: "gpt-4o" });
});

test("conversion: an explicit temperature hint becomes a param override", () => {
  const recipe = requirementToRecipe("聊天助手，temperature 0.5", DEFAULT_CATALOG);

  assert.deepEqual(recipe.parameters["model-openai"], { temperature: 0.5 });
});

test("conversion: an out-of-range parameter hint is rejected (recipe stays valid)", () => {
  assert.throws(
    () => requirementToRecipe("聊天助手，temperature 5.0", DEFAULT_CATALOG),
    /temperature/,
  );
});

test("conversion: pure and deterministic for identical input", () => {
  const requirement = "我要一个会查天气的 agent";

  const first = JSON.stringify(requirementToRecipe(requirement, DEFAULT_CATALOG));
  const second = JSON.stringify(requirementToRecipe(requirement, DEFAULT_CATALOG));

  assert.equal(first, second);
});

test("conversion: an injected catalog without the base components throws", () => {
  const minimal: ComponentCatalog = {
    components: [
      { id: "tool-caller", version: "1.0", params: {} },
    ],
  };

  assert.throws(() => requirementToRecipe("做个 agent", minimal), /not in catalog/);
});

test("conversion: output passes structure validation with a fixed catalog", () => {
  const fixed: ComponentCatalog = {
    components: [
      { id: "model-openai", version: "1.0", params: {} },
      { id: "context-window", version: "1.0", params: {} },
      { id: "tool-caller", version: "1.0", params: {} },
      { id: "agent-single", version: "1.0", params: {} },
    ],
  };

  const recipe = requirementToRecipe("会搜索的聊天 agent", fixed);

  assert.doesNotThrow(() => validateStructure(recipe));
  assert.deepEqual(
    recipe.components.map((c) => c.id).sort(),
    ["agent-single", "context-window", "model-openai", "tool-caller"],
  );
});

test("conversion: requirement mentioning ollama selects model-ollama", () => {
  const recipe = requirementToRecipe("用 ollama 做一个会算数的聊天 agent", DEFAULT_CATALOG);

  const ids = recipe.components.map((c) => c.id);
  assert.ok(ids.includes("model-ollama"));
  assert.ok(!ids.includes("model-openai"));
  assert.deepEqual(
    recipe.connections.find((c) => c.from === "model-ollama"),
    { from: "model-ollama", to: "agent-single" },
  );
});
