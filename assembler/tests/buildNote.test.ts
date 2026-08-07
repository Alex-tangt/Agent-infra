import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_CATALOG } from "../src/catalog.ts";
import { requirementToRecipe } from "../src/requirementToRecipe.ts";
import { composeBuildNote } from "../src/buildNote.ts";
import type { Answers } from "../src/clarify.ts";

test("buildNote: a decision is produced for every selected component", () => {
  const recipe = requirementToRecipe("会查天气的聊天 agent", DEFAULT_CATALOG);

  const note = composeBuildNote("会查天气的聊天 agent", recipe);

  const ids = note.decisions.map((d) => d.component).sort();
  assert.deepEqual(ids, ["agent-single", "context-window", "model-openai", "tool-caller"]);
  for (const decision of note.decisions) {
    assert.ok(decision.role.length > 0, `role for ${decision.component}`);
    assert.ok(decision.reason.length > 0, `reason for ${decision.component}`);
    assert.ok(decision.connections.length >= 1, `connections for ${decision.component}`);
  }
});

test("buildNote: the container decision lists every composition edge into agent-single", () => {
  const recipe = requirementToRecipe("会查天气的聊天 agent", DEFAULT_CATALOG);

  const note = composeBuildNote("会查天气的聊天 agent", recipe);

  const container = note.decisions.find((d) => d.component === "agent-single")!;
  assert.deepEqual(container.connections.sort(), [
    "context-window -> agent-single",
    "model-openai -> agent-single",
    "tool-caller -> agent-single",
  ]);
});

test("buildNote: the tool-caller reason reflects the requirement's tool signals", () => {
  const recipe = requirementToRecipe("我要一个会查天气的 agent", DEFAULT_CATALOG);

  const note = composeBuildNote("我要一个会查天气的 agent", recipe);

  const toolCaller = note.decisions.find((d) => d.component === "tool-caller")!;
  assert.match(toolCaller.reason, /天气|工具/);
});

test("buildNote: clarification answers are recorded as notes and skill is flagged", () => {
  const recipe = requirementToRecipe("做一个聊天 agent", DEFAULT_CATALOG);
  const answers: Answers = { model: "gpt-4o", tools: ["天气"] };

  const note = composeBuildNote("做一个聊天 agent", recipe, {
    answers,
    skills: [{ name: "agent-design", source: "injected" }],
  });

  assert.equal(note.skillUsed, "agent-design");
  assert.ok(note.notes.some((n) => n.includes("gpt-4o")));
  assert.ok(note.notes.some((n) => n.includes("天气")));
});

test("buildNote: key params are copied from the recipe", () => {
  const recipe = requirementToRecipe("用 gpt-4o 做个聊天助手", DEFAULT_CATALOG);

  const note = composeBuildNote("用 gpt-4o 做个聊天助手", recipe);

  const model = note.decisions.find((d) => d.component === "model-openai")!;
  assert.deepEqual(model.keyParams, { model: "gpt-4o" });
});

test("buildNote: no skill used when none was loaded", () => {
  const recipe = requirementToRecipe("会查天气的聊天 agent", DEFAULT_CATALOG);

  const note = composeBuildNote("会查天气的聊天 agent", recipe);

  assert.equal(note.skillUsed, null);
});
