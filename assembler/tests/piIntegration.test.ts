import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { assembleRequirement, assembleWithAnswers } from "../src/assemble.ts";
import { DEFAULT_CATALOG } from "../src/catalog.ts";
import { PiDriver } from "../src/piDriver.ts";
import type { Recipe } from "../src/recipe.ts";
import { validateStructure } from "../src/schema.ts";
import { validateParams } from "../src/validate.ts";

const SKILLS_DIR = join(process.cwd(), "..", "skills");

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

test("pi 集成: 需求→配方全流程（注入 mock 会话，不依赖真实模型）", async () => {
  const seen: string[] = [];
  const driver = new PiDriver({
    skillsDir: SKILLS_DIR,
    createSession: async () => ({
      run: async (prompt: string): Promise<Recipe> => {
        seen.push(prompt);
        return structuredClone(VALID_RECIPE) as Recipe;
      },
    }),
  });

  const result = await assembleRequirement("用 gpt-4o 做一个会查天气的 agent", { driver });

  assert.equal(result.status, "recipe");
  if (result.status === "recipe") {
    assert.doesNotThrow(() => validateStructure(result.recipe));
    assert.doesNotThrow(() => validateParams(result.recipe, DEFAULT_CATALOG));
    assert.equal(result.buildNote.skillUsed, "agent-design");
    assert.ok(result.buildNote.decisions.length > 0);
  }
  assert.equal(seen.length, 1);
  assert.match(seen[0]!, /structured_output/);
  assert.match(seen[0]!, /不写 demo 代码/);
});

test("pi 集成: 模糊需求走澄清分支，不创建会话不进模型", async () => {
  let sessionRuns = 0;
  const driver = new PiDriver({
    createSession: async () => ({
      run: async (): Promise<Recipe> => {
        sessionRuns += 1;
        return structuredClone(VALID_RECIPE) as Recipe;
      },
    }),
  });

  const result = await assembleRequirement("做一个带工具的 agent", { driver });

  assert.equal(result.status, "clarify");
  if (result.status === "clarify") {
    assert.ok(result.questions.some((q) => q.includes("工具")));
  }
  assert.equal(sessionRuns, 0, "澄清分支不应进入模型会话");
});

test("pi 集成: 澄清 → 回答 → 配方闭环（answers 并入会话 prompt）", async () => {
  const seen: string[] = [];
  const driver = new PiDriver({
    createSession: async () => ({
      run: async (prompt: string): Promise<Recipe> => {
        seen.push(prompt);
        return structuredClone(VALID_RECIPE) as Recipe;
      },
    }),
  });

  const first = await assembleRequirement("做一个带工具的 agent", { driver });
  assert.equal(first.status, "clarify");

  const second = await assembleWithAnswers(
    "做一个带工具的 agent",
    { model: "gpt-4o", tools: ["天气"] },
    { driver },
  );

  assert.equal(second.status, "recipe");
  if (second.status === "recipe") {
    assert.ok(second.buildNote.notes.some((n) => n.includes("gpt-4o")));
    assert.ok(second.buildNote.notes.some((n) => n.includes("天气")));
  }
  assert.equal(seen.length, 1);
  assert.match(seen[0]!, /gpt-4o/);
  assert.match(seen[0]!, /天气/);
});
