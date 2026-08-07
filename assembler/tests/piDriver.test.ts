import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import type { ResourceDiagnostic } from "@earendil-works/pi-coding-agent";

import { DEFAULT_CATALOG } from "../src/catalog.ts";
import {
  buildSkillOverrides,
  buildStructuredOutputTool,
  mergeSkillOverrides,
  PiDriver,
  type PiSession,
} from "../src/piDriver.ts";
import type { Recipe } from "../src/recipe.ts";
import { validateStructure } from "../src/schema.ts";

const SKILLS_DIR = join(process.cwd(), "..", "skills");

function asRecipeArgs(recipe: Recipe) {
  return recipe as unknown as Parameters<
    ReturnType<typeof buildStructuredOutputTool>["execute"]
  >[1];
}

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

test("piDriver: kind is pi", () => {
  const driver = new PiDriver({});

  assert.equal(driver.kind, "pi");
});

test("piDriver: a vague tool requirement raises questions", async () => {
  const driver = new PiDriver({});

  const acquisition = await driver.acquire("做一个 agent，带一些工具");

  assert.equal(acquisition.status, "clarify");
  if (acquisition.status === "clarify") {
    assert.ok(acquisition.questions.length > 0);
  }
});

test("piDriver: a clear requirement yields a ready prompt with skill + rules", async () => {
  const driver = new PiDriver({ skillsDir: SKILLS_DIR });

  const acquisition = await driver.acquire("会查天气的聊天 agent");

  assert.equal(acquisition.status, "ready");
  if (acquisition.status === "ready") {
    assert.match(acquisition.prompt, /structured_output/);
    assert.match(acquisition.prompt, /不写 demo 代码/);
    assert.match(acquisition.prompt, /agent-design/);
  }
});

test("piDriver: convert runs the injected pi session and returns the recipe", async () => {
  let seen = "";
  const session: PiSession = {
    async run(prompt: string): Promise<Recipe> {
      seen = prompt;
      return structuredClone(VALID_RECIPE) as Recipe;
    },
  };
  const driver = new PiDriver({
    createSession: async () => session,
  });

  const recipe = await driver.convert("会查天气的聊天 agent");

  assert.equal(recipe.name, "weather-agent");
  assert.doesNotThrow(() => validateStructure(recipe));
  assert.equal(seen, "会查天气的聊天 agent");
});

test("piDriver: an agent-like requirement marks the skill as pi-loaded", async () => {
  const driver = new PiDriver({ skillsDir: SKILLS_DIR });

  await driver.acquire("帮我做一个会查天气的聊天 agent");

  const used = driver.skillsUsed();
  assert.equal(used.length, 1);
  assert.equal(used[0]!.name, "agent-design");
  assert.equal(used[0]!.source, "pi");
});

test("pi: the structured_output tool terminates and returns the recipe as details", async () => {
  const tool = buildStructuredOutputTool(DEFAULT_CATALOG);

  assert.equal(tool.name, "structured_output");
  const result = await tool.execute(
    "1",
    asRecipeArgs(structuredClone(VALID_RECIPE) as Recipe),
    undefined,
    undefined,
    undefined as never,
  );

  assert.equal(result.terminate, true);
  assert.deepEqual(result.details, VALID_RECIPE);
});

test("pi: the structured_output tool rejects an out-of-catalog component", async () => {
  const tool = buildStructuredOutputTool(DEFAULT_CATALOG);

  const ghost = structuredClone(VALID_RECIPE) as Recipe;
  ghost.components.push({ id: "ghost-component", version: "1.0" });

  await assert.rejects(
    () =>
      tool.execute("1", asRecipeArgs(ghost), undefined, undefined, undefined as never),
    /not in catalog/,
  );
});

test("pi: buildSkillOverrides discovers the repo skill via pi's native loader", () => {
  const overrides = buildSkillOverrides(SKILLS_DIR);

  assert.ok(overrides.some((s) => s.name === "agent-design"));
  const skill = overrides.find((s) => s.name === "agent-design")!;
  assert.match(skill.description, /agent = 模型管理 \+ 上下文管理 \+ 工具调用/);
});

test("pi: mergeSkillOverrides appends repo skills into the loader base", () => {
  const repo = buildSkillOverrides(SKILLS_DIR);
  const merge = mergeSkillOverrides(repo);
  const base = {
    skills: [{ ...repo[0]!, name: "builtin" }],
    diagnostics: [] as ResourceDiagnostic[],
  };

  const merged = merge(base);

  assert.ok(merged.skills.some((s) => s.name === "builtin"));
  assert.ok(merged.skills.some((s) => s.name === "agent-design"));
});
