import { test } from "node:test";
import assert from "node:assert/strict";

import { runAcquire } from "../src/driver.ts";

test("runAcquire: 模糊需求返回澄清问题且清空 loaded，不进匹配/组装", () => {
  const { acquisition, loaded } = runAcquire("做一个带工具的 agent", undefined, {
    clarify: () => ["需要哪些工具？"],
    matchSkills: () => {
      throw new Error("模糊需求不应匹配 skill");
    },
    buildPrompt: () => {
      throw new Error("模糊需求不应组装 prompt");
    },
    toSkillReference: (skill) => skill,
  });

  assert.deepEqual(acquisition, {
    status: "clarify",
    questions: ["需要哪些工具？"],
  });
  assert.deepEqual(loaded, []);
});

test("runAcquire: answers 并入需求文本后走 ready 路径", () => {
  const { acquisition, loaded } = runAcquire(
    "做一个带工具的 agent",
    { model: "gpt-4o" },
    {
      clarify: (text) => (text.includes("gpt-4o") ? [] : ["选哪个模型？"]),
      matchSkills: (text) =>
        text.includes("agent") ? [{ name: "agent-design", source: "pi" as const }] : [],
      buildPrompt: (text) => `prompt: ${text}`,
      toSkillReference: (skill) => skill,
    },
  );

  assert.equal(acquisition.status, "ready");
  if (acquisition.status === "ready") {
    assert.match(acquisition.prompt, /gpt-4o/);
  }
  assert.deepEqual(loaded, [{ name: "agent-design", source: "pi" }]);
});

test("runAcquire: skill 未命中时 loaded 为空但 prompt 照常组装", () => {
  const { acquisition, loaded } = runAcquire("帮我写一个 python 排序脚本", undefined, {
    clarify: () => [],
    matchSkills: () => [],
    buildPrompt: (text) => text,
    toSkillReference: () => {
      throw new Error("空匹配不应调用 skill 引用映射");
    },
  });

  assert.equal(acquisition.status, "ready");
  if (acquisition.status === "ready") {
    assert.equal(acquisition.prompt, "帮我写一个 python 排序脚本");
  }
  assert.deepEqual(loaded, []);
});
