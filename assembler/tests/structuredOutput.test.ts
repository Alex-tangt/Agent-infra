import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_CATALOG } from "../src/catalog.ts";
import {
  constrainToRecipe,
  createStructuredOutputTool,
  type LlmLike,
} from "../src/structuredOutput.ts";

const VALID_RECIPE_JSON = JSON.stringify({
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
});

function fakeLlm(raw: string): LlmLike {
  return async () => raw;
}

test("tool: exposes a structured_output tool with a TypeBox parameters schema", () => {
  const tool = createStructuredOutputTool(fakeLlm(VALID_RECIPE_JSON), DEFAULT_CATALOG);

  assert.equal(tool.name, "structured_output");
  assert.equal(tool.terminate, true);
  assert.equal(typeof tool.parameters, "object");
  assert.equal(tool.parameters.type, "object");
  assert.ok(tool.parameters.properties?.components);
});

test("tool: a valid model output is constrained into a Recipe", async () => {
  const tool = createStructuredOutputTool(fakeLlm(VALID_RECIPE_JSON), DEFAULT_CATALOG);

  const recipe = await tool.execute("我要一个会查天气的 agent");

  assert.equal(recipe.name, "weather-agent");
  assert.equal(recipe.components.length, 3);
  assert.deepEqual(recipe.parameters["model-openai"], { temperature: 0.5 });
});

test("tool: non-JSON model output is rejected", async () => {
  const tool = createStructuredOutputTool(fakeLlm("not json"), DEFAULT_CATALOG);

  await assert.rejects(() => tool.execute("要求"), /not valid JSON/);
});

test("tool: output missing a required field is rejected by the schema", async () => {
  const missingComponents = JSON.stringify({
    name: "weather-agent",
    connections: [],
    parameters: {},
  });
  const tool = createStructuredOutputTool(fakeLlm(missingComponents), DEFAULT_CATALOG);

  await assert.rejects(() => tool.execute("要求"), /components/);
});

test("tool: output referencing an unknown component is rejected by the catalog", async () => {
  const ghostComponent = JSON.stringify({
    components: [{ id: "ghost-component", version: "1.0" }],
    connections: [],
    parameters: {},
  });
  const tool = createStructuredOutputTool(fakeLlm(ghostComponent), DEFAULT_CATALOG);

  await assert.rejects(() => tool.execute("要求"), /not in catalog/);
});

test("tool: output with an unexpected top-level field is rejected (strict schema)", async () => {
  const extraField = JSON.stringify({
    ...JSON.parse(VALID_RECIPE_JSON),
    spurious: true,
  });
  const tool = createStructuredOutputTool(fakeLlm(extraField), DEFAULT_CATALOG);

  await assert.rejects(() => tool.execute("要求"), /spurious|unexpected property/);
});

test("tool: output with an out-of-range parameter is rejected", async () => {
  const badParam = JSON.stringify({
    ...JSON.parse(VALID_RECIPE_JSON),
    parameters: { "model-openai": { temperature: 9.9 } },
  });
  const tool = createStructuredOutputTool(fakeLlm(badParam), DEFAULT_CATALOG);

  await assert.rejects(() => tool.execute("要求"), /temperature|above max/);
});

test("constrainToRecipe: validates a raw model string against schema + catalog", () => {
  const recipe = constrainToRecipe(VALID_RECIPE_JSON, DEFAULT_CATALOG);

  assert.equal(recipe.name, "weather-agent");
});

test("constrainToRecipe: rejects a recipe whose connection points at a ghost id", () => {
  const ghostConnection = JSON.stringify({
    ...JSON.parse(VALID_RECIPE_JSON),
    connections: [{ from: "context-window", to: "ghost-component" }],
  });

  assert.throws(() => constrainToRecipe(ghostConnection, DEFAULT_CATALOG), /ghost-component/);
});
