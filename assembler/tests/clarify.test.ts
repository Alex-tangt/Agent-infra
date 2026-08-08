import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CATALOG,
  type ComponentCatalog,
} from "../src/catalog.ts";
import {
  needsClarification,
  withAnswers,
  type Answers,
} from "../src/clarify.ts";

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
