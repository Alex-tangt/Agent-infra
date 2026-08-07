import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CATALOG,
  type ComponentCatalog,
} from "../src/catalog.ts";
import { requirementToRecipe } from "../src/requirementToRecipe.ts";
import { validateStructure } from "../src/schema.ts";
import { validateParams } from "../src/validate.ts";
import type { LlmLike } from "../src/structuredOutput.ts";
import {
  applyAnswers,
  assembleRequirement,
  assembleWithAnswers,
  needsClarification,
  withAnswers,
  type Answers,
} from "../src/clarify.ts";

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

test("clarify: a vague tool request raises a tool-list question", () => {
  const questions = needsClarification("做一个 agent，带一些工具");

  assert.ok(questions.length > 0);
  assert.match(questions[0]!, /工具/);
});

test("clarify: a model intent without a concrete model raises a model question", () => {
  const questions = needsClarification("用哪个模型做个聊天 agent");

  assert.ok(questions.length > 0);
  assert.match(questions[0]!, /模型/);
});

test("clarify: a fully specified requirement asks nothing (no over-asking)", () => {
  const questions = needsClarification("用 gpt-4o 做一个会查天气的 agent");

  assert.deepEqual(questions, []);
});

test("clarify: a plain chat requirement asks nothing (defaults apply)", () => {
  const questions = needsClarification("帮我做个能对话的聊天机器人");

  assert.deepEqual(questions, []);
});

test("clarify: the model question lists choices from the injected catalog", () => {
  const catalog: ComponentCatalog = {
    components: [
      {
        id: "model-openai",
        version: "1.0",
        params: { model: { type: "string", enum: ["gpt-4o", "gpt-4o-turbo"] } },
      },
    ],
  };

  const questions = needsClarification("用哪个模型做 agent", catalog);

  assert.ok(questions.some((q) => q.includes("gpt-4o-turbo")));
});

test("clarify: a catalog without a model component raises no model question", () => {
  const catalog: ComponentCatalog = {
    components: [
      { id: "tool-caller", version: "1.0", params: {} },
      { id: "agent-single", version: "1.0", params: {} },
    ],
  };

  assert.deepEqual(needsClarification("用哪个模型做 agent", catalog), []);
});

test("withAnswers: answers are folded into the requirement text as generation context", () => {
  const answers: Answers = { model: "gpt-4o", tools: ["天气", "搜索"] };

  const context = withAnswers("做一个带工具的 agent", answers);

  assert.match(context, /gpt-4o/);
  assert.match(context, /天气/);
  assert.match(context, /搜索/);
  assert.match(context, /工具/);
});

test("applyAnswers: model and tool answers become param overrides", () => {
  const base = requirementToRecipe("做一个聊天 agent", DEFAULT_CATALOG);

  const recipe = applyAnswers(base, { model: "gpt-4o", tools: ["天气"] });

  assert.deepEqual(recipe.parameters["model-openai"], { model: "gpt-4o" });
  assert.deepEqual(recipe.parameters["tool-caller"], { tools: ["天气"] });
  assert.ok(
    recipe.components.some((c) => c.id === "tool-caller"),
    "tool-caller component should be present",
  );
  assert.doesNotThrow(() => validateStructure(recipe));
});

test("applyAnswers: a tool answer adds and wires tool-caller when the recipe lacks it", () => {
  const base = requirementToRecipe("帮我做个聊天机器人", DEFAULT_CATALOG);

  const recipe = applyAnswers(base, { tools: ["搜索"] });

  const toolCaller = recipe.components.find((c) => c.id === "tool-caller");
  assert.ok(toolCaller, "tool-caller should be added");
  assert.equal(toolCaller!.version, "1.0");
  assert.deepEqual(recipe.parameters["tool-caller"], { tools: ["搜索"] });
  assert.doesNotThrow(() => validateStructure(recipe));
  assert.doesNotThrow(() => validateParams(recipe, DEFAULT_CATALOG));
});

test("applyAnswers: an out-of-enum model answer is rejected (recipe stays valid)", () => {
  const base = requirementToRecipe("做一个聊天 agent", DEFAULT_CATALOG);

  assert.throws(
    () => applyAnswers(base, { model: "gpt-4o-ultra" }),
    /model-openai/,
  );
});

test("assembleRequirement: a clear requirement goes straight to the LLM and yields a recipe", async () => {
  let calls = 0;
  const llm: LlmLike = () => {
    calls += 1;
    return VALID_RECIPE_JSON;
  };

  const result = await assembleRequirement("用 gpt-4o 做一个会查天气的 agent", llm);

  assert.equal(result.status, "recipe");
  if (result.status === "recipe") {
    assert.equal(result.recipe.name, "weather-agent");
  }
  assert.equal(calls, 1);
});

test("assembleRequirement: an ambiguous requirement raises questions and skips the LLM", async () => {
  let calls = 0;
  const llm: LlmLike = () => {
    calls += 1;
    throw new Error("llm should not be called");
  };

  const result = await assembleRequirement("做一个带工具的 agent", llm);

  assert.equal(result.status, "clarify");
  if (result.status === "clarify") {
    assert.ok(result.questions.length > 0);
  }
  assert.equal(calls, 0);
});

test("assembleWithAnswers: answers enter the generation prompt and land in the recipe", async () => {
  let prompt = "";
  const llm: LlmLike = (requirement) => {
    prompt = requirement;
    return VALID_RECIPE_JSON;
  };

  const recipe = await assembleWithAnswers(
    "做一个带工具的 agent",
    { model: "gpt-4o", tools: ["天气"] },
    llm,
  );

  assert.match(prompt, /gpt-4o/);
  assert.match(prompt, /天气/);
  assert.deepEqual(recipe.parameters["model-openai"], {
    model: "gpt-4o",
    temperature: 0.5,
  });
  assert.deepEqual(recipe.parameters["tool-caller"], { tools: ["天气"] });
});
