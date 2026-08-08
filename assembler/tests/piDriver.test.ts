import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import type { ResourceDiagnostic } from "@earendil-works/pi-coding-agent";

import { DEFAULT_CATALOG } from "../src/catalog.ts";
import {
  buildPiPrompt,
  buildSkillOverrides,
  mergeSkillOverrides,
  PiDriver,
  stripCodeFence,
  DEFAULT_EXAMPLE_PATH,
  type PiSession,
} from "../src/piDriver.ts";

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

test("piDriver: a clear requirement yields a ready prompt with example path + rules", async () => {
  const driver = new PiDriver({ skillsDir: SKILLS_DIR });

  const acquisition = await driver.acquire("会查天气的聊天 agent");

  assert.equal(acquisition.status, "ready");
  if (acquisition.status === "ready") {
    assert.match(acquisition.prompt, /demos\/calculator_agent\.py/);
    assert.match(acquisition.prompt, /只产出 demo 代码/);
    assert.match(acquisition.prompt, /run\(user_message: str\)/);
    assert.match(acquisition.prompt, /agent-design/);
  }
});

test("piDriver: buildPiPrompt injects the example path, rules and component usage notes", () => {
  const prompt = buildPiPrompt(
    "会查天气的聊天 agent",
    [],
    DEFAULT_CATALOG,
    DEFAULT_EXAMPLE_PATH,
  );

  assert.match(prompt, /会查天气的聊天 agent/);
  assert.match(prompt, /demos\/calculator_agent\.py/);
  assert.match(prompt, /只产出 demo 代码/);
  assert.match(prompt, /组件使用说明/);
  assert.match(prompt, /agent-single/);
});

test("piDriver: stripCodeFence removes a python fence and keeps the code", () => {
  const fenced = "```python\n" + DEMO_CODE + "\n```";

  assert.equal(stripCodeFence(fenced), DEMO_CODE);
});

test("piDriver: stripCodeFence leaves plain text untouched", () => {
  assert.equal(stripCodeFence(DEMO_CODE), DEMO_CODE);
});

test("piDriver: convert runs the injected pi session and returns the demo code", async () => {
  let seen = "";
  const session: PiSession = {
    async run(prompt: string): Promise<string> {
      seen = prompt;
      return DEMO_CODE;
    },
  };
  const driver = new PiDriver({
    createSession: async () => session,
  });

  const code = await driver.convert("会查天气的聊天 agent");

  assert.equal(code, DEMO_CODE);
  assert.match(code, /def run\(user_message: str\)/);
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
