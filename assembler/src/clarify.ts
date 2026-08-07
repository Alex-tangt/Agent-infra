import {
  DEFAULT_CATALOG,
  findComponent,
  requireComponent,
  type ComponentCatalog,
} from "./catalog.ts";
import type { Recipe } from "./recipe.ts";
import {
  createStructuredOutputTool,
  type LlmLike,
} from "./structuredOutput.ts";
import { validateParams } from "./validate.ts";

const MODEL_INTENT_SIGNALS = ["模型", "model"] as const;

const MODEL_SIGNALS = ["gpt-4o-mini", "gpt-4o"] as const;

const GENERIC_TOOL_SIGNALS = ["工具", "tool"] as const;

const CONCRETE_TOOL_SIGNALS = [
  "查",
  "搜索",
  "查询",
  "天气",
  "weather",
  "search",
  "计算",
  "calc",
] as const;

function hasAnySignal(text: string, signals: readonly string[]): boolean {
  return signals.some((signal) => text.includes(signal));
}

export interface Answers {
  model?: string;
  tools?: string[];
}

export function withAnswers(requirement: string, answers: Answers): string {
  const parts: string[] = [requirement];
  if (answers.model) {
    parts.push(`使用模型 ${answers.model}`);
  }
  if (answers.tools && answers.tools.length > 0) {
    parts.push(`需要工具：${answers.tools.join("、")}`);
  }
  return parts.join("。");
}

function addToolCaller(recipe: Recipe, catalog: ComponentCatalog): void {
  if (recipe.components.some((c) => c.id === "tool-caller")) {
    return;
  }
  const entry = requireComponent(catalog, "tool-caller");
  recipe.components.push({ id: "tool-caller", version: entry.version });

  if (recipe.components.some((c) => c.id === "agent-single")) {
    recipe.connections.push({ from: "tool-caller", to: "agent-single" });
    return;
  }
  const serialEdgeIndex = recipe.connections.findIndex(
    (c) => c.from === "context-window" && c.to === "model-openai",
  );
  if (serialEdgeIndex >= 0) {
    recipe.connections.splice(
      serialEdgeIndex,
      1,
      { from: "context-window", to: "tool-caller" },
      { from: "tool-caller", to: "model-openai" },
    );
  } else {
    recipe.connections.push(
      { from: "context-window", to: "tool-caller" },
      { from: "tool-caller", to: "model-openai" },
    );
  }
}

export function applyAnswers(
  recipe: Recipe,
  answers: Answers,
  catalog: ComponentCatalog = DEFAULT_CATALOG,
): Recipe {
  const updated = structuredClone(recipe) as Recipe;

  if (answers.model) {
    updated.parameters["model-openai"] = {
      ...updated.parameters["model-openai"],
      model: answers.model,
    };
  }
  if (answers.tools) {
    if (answers.tools.length > 0) {
      addToolCaller(updated, catalog);
    }
    if (updated.components.some((c) => c.id === "tool-caller")) {
      updated.parameters["tool-caller"] = {
        ...updated.parameters["tool-caller"],
        tools: [...answers.tools],
      };
    }
  }

  validateParams(updated, catalog);
  return updated;
}

export type AssemblyResult =
  | { status: "clarify"; questions: string[] }
  | { status: "recipe"; recipe: Recipe };

export async function assembleRequirement(
  requirement: string,
  llm: LlmLike,
  catalog: ComponentCatalog = DEFAULT_CATALOG,
): Promise<AssemblyResult> {
  const questions = needsClarification(requirement, catalog);
  if (questions.length > 0) {
    return { status: "clarify", questions };
  }
  const tool = createStructuredOutputTool(llm, catalog);
  const recipe = await tool.execute(requirement);
  return { status: "recipe", recipe };
}

export async function assembleWithAnswers(
  requirement: string,
  answers: Answers,
  llm: LlmLike,
  catalog: ComponentCatalog = DEFAULT_CATALOG,
): Promise<Recipe> {
  const tool = createStructuredOutputTool(llm, catalog);
  const recipe = await tool.execute(withAnswers(requirement, answers));
  return applyAnswers(recipe, answers, catalog);
}

function modelChoices(catalog: ComponentCatalog): string[] {
  return findComponent(catalog, "model-openai")?.params.model?.enum ?? [];
}

export function needsClarification(
  requirement: string,
  catalog: ComponentCatalog = DEFAULT_CATALOG,
): string[] {
  const text = requirement.toLowerCase();
  const questions: string[] = [];

  const mentionsModel = hasAnySignal(text, MODEL_INTENT_SIGNALS);
  const mentionsConcreteModel = hasAnySignal(text, MODEL_SIGNALS);
  const choices = modelChoices(catalog);
  if (mentionsModel && !mentionsConcreteModel && choices.length > 0) {
    questions.push(`选哪个模型？可选：${choices.join("、")}`);
  }

  const mentionsGenericTool = hasAnySignal(text, GENERIC_TOOL_SIGNALS);
  if (mentionsGenericTool && !hasAnySignal(text, CONCRETE_TOOL_SIGNALS)) {
    questions.push("需要哪些工具？例如：天气、搜索、计算");
  }

  return questions;
}
