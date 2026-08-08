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

const DEMO_CODE = [
  "from components.agent import Agent, register_agent",
  "from components.context import ContextWindow, register_context",
  "from components.model import OpenAIModel, register_model",
  "from components.tools import Tool, ToolCaller, register_tool_caller",
  "",
  "context_window = ContextWindow(max_rounds=5, strategy=\"truncate\")",
  "model = OpenAIModel(model=\"gpt-4o-mini\", temperature=0.7, max_tokens=1024)",
  "tool_caller = ToolCaller(tools=[], strategy=\"strict\")",
  "agent_single = Agent(model=model, context=context_window, tools=tool_caller, max_iterations=3)",
  "",
  "def run(user_message: str) -> str:",
  "    return agent_single.run(user_message)",
  "",
].join("\n");

type MockResult =
  | { questions: string[] }
  | { code: string; spec?: Recipe | null };

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

  async convert(prompt: string): Promise<string> {
    this.converted.push(prompt);
    if (!("code" in this.result)) {
      throw new Error("convert should not run while clarifying");
    }
    return this.result.code;
  }

  async spec(_prompt: string): Promise<Recipe | null> {
    return "spec" in this.result ? (this.result.spec ?? null) : null;
  }

  skillsUsed(): SkillReference[] {
    return "code" in this.result
      ? [{ name: "agent-design", source: "pi" }]
      : [];
  }
}

test("entry: a clear requirement runs acquire -> convert -> code + spec + build note", async () => {
  const driver = new MockDriver({ code: DEMO_CODE, spec: VALID_RECIPE });

  const result = await assembleRequirement("会查天气的聊天 agent", { driver });

  assert.equal(result.status, "recipe");
  if (result.status === "recipe") {
    assert.match(result.code, /def run\(user_message: str\)/);
    assert.equal(result.spec?.name, "weather-agent");
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
  const driver = new MockDriver({ code: DEMO_CODE, spec: VALID_RECIPE });

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

test("entry: a bad transient spec does not block code output (code wins)", async () => {
  const invalid = { name: "x", connections: [], parameters: {} } as unknown as Recipe;
  const driver = new MockDriver({ code: DEMO_CODE, spec: invalid });

  const result = await assembleRequirement("会查天气的聊天 agent", { driver });

  assert.equal(result.status, "recipe");
  if (result.status === "recipe") {
    assert.match(result.code, /def run\(user_message: str\)/);
    assert.equal(result.spec, null, "无效 spec 降级为 null，不阻塞代码产出");
    assert.deepEqual(result.buildNote.decisions, []);
  }
});

test("entry: build note explains the selected components and wiring", async () => {
  const driver = new MockDriver({ code: DEMO_CODE, spec: VALID_RECIPE });

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
