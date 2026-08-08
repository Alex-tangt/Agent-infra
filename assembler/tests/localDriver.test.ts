import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { LocalDriver } from "../src/localDriver.ts";
import type { Acquisition } from "../src/driver.ts";

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

test("localDriver: deterministic conversion yields demo code with run() + registered component construction", async () => {
  const driver = new LocalDriver({});

  const ready = isReady(await driver.acquire("会查天气的聊天 agent"));
  const code = await driver.convert(ready.prompt);

  assert.match(code, /def run\(user_message: str\)/);
  assert.match(code, /ContextWindow\(max_rounds=5, strategy="truncate"\)/);
  assert.match(code, /OpenAIModel\(model="gpt-4o-mini", temperature=0\.7, max_tokens=1024\)/);
  assert.match(code, /Agent\(/);
});

test("localDriver: ollama requirement swaps the model construction to OllamaModel", async () => {
  const driver = new LocalDriver({});

  const ready = isReady(await driver.acquire("用 ollama 做一个会算数的聊天 agent"));
  const code = await driver.convert(ready.prompt);

  assert.match(code, /OllamaModel/);
  assert.doesNotMatch(code, /OpenAIModel/);
  assert.match(code, /def run\(user_message: str\)/);
});

test("localDriver: conversion is deterministic for the same requirement", async () => {
  const driver = new LocalDriver({});

  const ready = isReady(await driver.acquire("会查天气的聊天 agent"));
  const first = await driver.convert(ready.prompt);
  const second = await driver.convert(ready.prompt);

  assert.equal(first, second);
});

test("localDriver: convert output surfaces a transient spec for validation", async () => {
  const driver = new LocalDriver({});

  const ready = isReady(await driver.acquire("会查天气的聊天 agent"));
  const spec = await driver.spec(ready.prompt);

  assert.ok(spec, "spec 应为可校验的瞬态声明");
  assert.equal(spec!.name, "weather-agent");
  assert.ok(spec!.components.length > 0);
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
