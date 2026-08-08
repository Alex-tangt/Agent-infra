import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { assembleRequirement, assembleWithAnswers } from "../src/assemble.ts";
import { PiDriver } from "../src/piDriver.ts";

const SKILLS_DIR = join(process.cwd(), "..", "skills");

const DEMO_CODE = [
  "from components.agent import Agent, register_agent",
  "from components.context import ContextWindow, register_context",
  "from components.model import OpenAIModel, register_model",
  "",
  "context_window = ContextWindow(max_rounds=5, strategy=\"truncate\")",
  "model = OpenAIModel(model=\"gpt-4o-mini\", temperature=0.7, max_tokens=1024)",
  "agent_single = Agent(model=model, context=context_window, tools=None, max_iterations=3)",
  "",
  "def run(user_message: str) -> str:",
  "    return agent_single.run(user_message)",
  "",
].join("\n");

test("pi 集成: 需求→demo 代码全流程（注入 mock 会话，不依赖真实模型）", async () => {
  const seen: string[] = [];
  const driver = new PiDriver({
    skillsDir: SKILLS_DIR,
    createSession: async () => ({
      run: async (prompt: string): Promise<string> => {
        seen.push(prompt);
        return DEMO_CODE;
      },
    }),
  });

  const result = await assembleRequirement("用 gpt-4o 做一个会查天气的 agent", { driver });

  assert.equal(result.status, "recipe");
  if (result.status === "recipe") {
    assert.match(result.code, /def run\(user_message: str\)/);
    assert.equal(result.spec, null, "pi 驱动不产瞬态 spec → null");
    assert.equal(result.buildNote.skillUsed, "agent-design");
  }
  assert.equal(seen.length, 1);
  assert.match(seen[0]!, /demos\/calculator_agent\.py/);
  assert.match(seen[0]!, /只产出 demo 代码/);
});

test("pi 集成: 模糊需求走澄清分支，不创建会话不进模型", async () => {
  let sessionRuns = 0;
  const driver = new PiDriver({
    createSession: async () => ({
      run: async (): Promise<string> => {
        sessionRuns += 1;
        return DEMO_CODE;
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

test("pi 集成: 澄清 → 回答 → demo 代码闭环（answers 并入会话 prompt）", async () => {
  const seen: string[] = [];
  const driver = new PiDriver({
    createSession: async () => ({
      run: async (prompt: string): Promise<string> => {
        seen.push(prompt);
        return DEMO_CODE;
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
