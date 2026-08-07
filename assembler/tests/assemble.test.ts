import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_CATALOG } from "../src/catalog.ts";
import {
  assembleRequirement,
  assembleWithAnswers,
  createDefaultDriver,
} from "../src/assemble.ts";
import type { Answers } from "../src/clarify.ts";
import type { Acquisition, AssemblerDriver, SkillReference } from "../src/driver.ts";
import type { Recipe } from "../src/recipe.ts";
import { validateStructure } from "../src/schema.ts";
import { validateParams } from "../src/validate.ts";

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

type MockResult = { questions: string[] } | { recipe: Recipe };

class MockDriver implements AssemblerDriver {
  readonly kind = "local" as const;
  readonly acquired: string[] = [];
  readonly converted: string[] = [];
  private readonly result: MockResult;

  constructor(result: MockResult) {
    this.result = result;
  }

  async acquire(requirement: string, _answers?: Answers): Promise<Acquisition> {
    this.acquired.push(requirement);
    if ("questions" in this.result) {
      return { status: "clarify", questions: this.result.questions };
    }
    return { status: "ready", prompt: requirement };
  }

  async convert(prompt: string): Promise<Recipe> {
    this.converted.push(prompt);
    if (!("recipe" in this.result)) {
      throw new Error("convert should not run while clarifying");
    }
    return structuredClone(this.result.recipe) as Recipe;
  }

  skillsUsed(): SkillReference[] {
    return "recipe" in this.result
      ? [{ name: "agent-design", source: "pi" }]
      : [];
  }
}

test("entry: a clear requirement runs acquire -> convert -> recipe + build note", async () => {
  const driver = new MockDriver({ recipe: VALID_RECIPE });

  const result = await assembleRequirement("会查天气的聊天 agent", { driver });

  assert.equal(result.status, "recipe");
  if (result.status === "recipe") {
    assert.doesNotThrow(() => validateStructure(result.recipe));
    assert.doesNotThrow(() => validateParams(result.recipe, DEFAULT_CATALOG));
    assert.equal(result.buildNote.skillUsed, "agent-design");
    assert.ok(result.buildNote.decisions.length > 0);
  }
  assert.deepEqual(driver.acquired, ["会查天气的聊天 agent"]);
  assert.deepEqual(driver.converted, ["会查天气的聊天 agent"]);
});

test("entry: an ambiguous requirement returns questions and skips conversion", async () => {
  const driver = new MockDriver({ questions: ["选哪个模型？"] });

  const result = await assembleRequirement("用哪个模型做 agent", { driver });

  assert.equal(result.status, "clarify");
  if (result.status === "clarify") {
    assert.deepEqual(result.questions, ["选哪个模型？"]);
  }
  assert.deepEqual(driver.converted, []);
});

test("entry: assembleWithAnswers forwards answers and records them in the build note", async () => {
  const driver = new MockDriver({ recipe: VALID_RECIPE });

  const result = await assembleWithAnswers(
    "做一个带工具的 agent",
    { model: "gpt-4o", tools: ["天气"] },
    { driver },
  );

  assert.equal(result.status, "recipe");
  if (result.status === "recipe") {
    assert.ok(result.buildNote.notes.some((n) => n.includes("gpt-4o")));
    assert.ok(result.buildNote.notes.some((n) => n.includes("天气")));
  }
});

test("entry: a driver recipe failing schema self-check is rejected", async () => {
  const invalid = { name: "x", connections: [], parameters: {} } as unknown as Recipe;
  const driver = new MockDriver({ recipe: invalid });

  await assert.rejects(
    () => assembleRequirement("会查天气的聊天 agent", { driver }),
    /components/,
  );
});

test("entry: build note explains the selected components and wiring", async () => {
  const driver = new MockDriver({ recipe: VALID_RECIPE });

  const result = await assembleRequirement("会查天气的聊天 agent", { driver });

  if (result.status === "recipe") {
    const toolCaller = result.buildNote.decisions.find(
      (d) => d.component === "tool-caller",
    );
    assert.ok(toolCaller);
    assert.ok(toolCaller!.reason.length > 0);
    assert.ok(toolCaller!.connections.includes("model-openai -> tool-caller"));
    assert.deepEqual(toolCaller!.keyParams, {});
  } else {
    assert.fail("expected a recipe result");
  }
});

test("entry: the default driver is the pi driver when pi is installed", async () => {
  const driver = await createDefaultDriver();

  assert.equal(driver.kind, "pi");
});
