import {
  DEFAULT_CATALOG,
  findComponent,
  type ComponentCatalog,
} from "./catalog.ts";
import {
  CONCRETE_MODEL_SIGNALS,
  CONCRETE_TOOL_SIGNALS,
  GENERIC_TOOL_SIGNALS,
  MODEL_INTENT_SIGNALS,
  resolveModelComponent,
} from "./signals.ts";

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

function modelChoices(catalog: ComponentCatalog, modelComponent: string): string[] {
  return findComponent(catalog, modelComponent)?.params.model?.enum ?? [];
}

export function needsClarification(
  requirement: string,
  catalog: ComponentCatalog = DEFAULT_CATALOG,
  modelComponent = "model-openai",
): string[] {
  const text = requirement.toLowerCase();
  const questions: string[] = [];

  const mentionsModel = hasAnySignal(text, MODEL_INTENT_SIGNALS);
  const mentionsConcreteModel = hasAnySignal(text, CONCRETE_MODEL_SIGNALS);
  const choices = modelChoices(catalog, resolveModelComponent(text, modelComponent));
  if (mentionsModel && !mentionsConcreteModel && choices.length > 0) {
    questions.push(`选哪个模型？可选：${choices.join("、")}`);
  }

  const mentionsGenericTool = hasAnySignal(text, GENERIC_TOOL_SIGNALS);
  if (mentionsGenericTool && !hasAnySignal(text, CONCRETE_TOOL_SIGNALS)) {
    questions.push("需要哪些工具？例如：天气、搜索、计算");
  }

  return questions;
}
