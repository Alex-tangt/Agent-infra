import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { DEFAULT_CATALOG } from "../src/catalog.ts";
import { LocalDriver } from "../src/localDriver.ts";
import { validateStructure } from "../src/schema.ts";
import { validateParams } from "../src/validate.ts";
import type { LlmLike } from "../src/structuredOutput.ts";
import type { Acquisition } from "../src/driver.ts";

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

const SKILLS_DIR = join(process.cwd(), "..", "skills", "agent-design");

function isReady(acquisition: Acquisition) {
  assert.equal(acquisition.status, "ready");
  return acquisition;
}

test("localDriver: a vague tool requirement raises questions, not a prompt", async () => {
  const driver = new LocalDriver({});

  const acquisition = await driver.acquire("做一个 agent，带一些工具");

  assert.equal(acquisition.status, "clarify");
  if (acquisition.status === "clarify") {
    assert.ok(acquisition.questions.length > 0);
  }
});

test("localDriver: a fully specified requirement yields a ready prompt", async () => {
  const driver = new LocalDriver({});

  const acquisition = await driver.acquire("用 gpt-4o 做一个会查天气的 agent");

  assert.equal(acquisition.status, "ready");
  assert.equal(acquisition.prompt, "用 gpt-4o 做一个会查天气的 agent");
});

test("localDriver: answers are folded into the prompt for a clarified requirement", async () => {
  const driver = new LocalDriver({});

  const acquisition = await driver.acquire("做一个带工具的 agent", {
    model: "gpt-4o",
    tools: ["天气"],
  });

  const ready = isReady(acquisition);
  assert.match(ready.prompt, /gpt-4o/);
  assert.match(ready.prompt, /天气/);
});

test("localDriver: deterministic conversion yields a schema-valid recipe", async () => {
  const driver = new LocalDriver({});

  const ready = isReady(await driver.acquire("会查天气的聊天 agent"));
  const recipe = await driver.convert(ready.prompt);

  assert.doesNotThrow(() => validateStructure(recipe));
  assert.doesNotThrow(() => validateParams(recipe, DEFAULT_CATALOG));
});

test("localDriver: llm conversion constrains a mock model output into a recipe", async () => {
  const llm: LlmLike = () => VALID_RECIPE_JSON;
  const driver = new LocalDriver({ llm, useLlm: true });

  const ready = isReady(await driver.acquire("会查天气的聊天 agent"));
  const recipe = await driver.convert(ready.prompt);

  assert.equal(recipe.name, "weather-agent");
  assert.doesNotThrow(() => validateStructure(recipe));
});

test("localDriver: an agent-like requirement loads the design skill (injected)", async () => {
  const driver = new LocalDriver({ skillsDir: SKILLS_DIR });

  await driver.acquire("帮我做一个会查天气的聊天 agent");

  const used = driver.skillsUsed();
  assert.equal(used.length, 1);
  assert.equal(used[0]!.name, "agent-design");
  assert.equal(used[0]!.source, "injected");
});

test("localDriver: a non-agent requirement loads no skill", async () => {
  const driver = new LocalDriver({ skillsDir: SKILLS_DIR });

  await driver.acquire("帮我写一个 python 排序脚本");

  assert.deepEqual(driver.skillsUsed(), []);
});

test("localDriver: the llm prompt carries skill context and operating rules", async () => {
  const llm: LlmLike = () => VALID_RECIPE_JSON;
  const driver = new LocalDriver({ llm, useLlm: true, skillsDir: SKILLS_DIR });

  const ready = isReady(await driver.acquire("会查天气的聊天 agent"));

  assert.match(ready.prompt, /agent-design/);
  assert.match(ready.prompt, /不写 demo 代码/);
});
