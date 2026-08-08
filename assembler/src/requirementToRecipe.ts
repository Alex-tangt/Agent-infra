import { DEFAULT_CATALOG, requireComponent, type ComponentCatalog } from "./catalog.ts";
import type { Recipe } from "./recipe.ts";
import {
  AGENT_SIGNALS,
  CONCRETE_MODEL_SIGNALS,
  TOOL_SIGNALS,
  resolveModelComponent,
} from "./signals.ts";
import { validateParams } from "./validate.ts";
import { validateStructure } from "./schema.ts";

// 具体模型信号 → 模型参数覆盖映射（型号词即参数值，单一来源在 signals.ts）
const MODEL_SIGNALS: Array<[string, string]> = CONCRETE_MODEL_SIGNALS.map(
  (signal) => [signal, signal] as [string, string],
);

const TEMPERATURE_PATTERN = /temperature\s+([0-9]+(?:\.[0-9]+)?)/;

function nameFromRequirement(requirement: string): string {
  const text = requirement.toLowerCase();
  if (/(天气|weather)/.test(text)) return "weather-agent";
  if (/(搜索|查询|search)/.test(text)) return "search-agent";
  if (/(聊天|对话|chat)/.test(text)) return "chat-agent";
  return "agent";
}

function hasAnySignal(text: string, signals: readonly string[]): boolean {
  return signals.some((signal) => text.includes(signal));
}

function resolveVersion(catalog: ComponentCatalog, id: string): string {
  return requireComponent(catalog, id).version;
}

export function requirementToRecipe(
  requirement: string,
  catalog: ComponentCatalog = DEFAULT_CATALOG,
  modelComponent = "model-openai",
): Recipe {
  const text = requirement.toLowerCase();

  const wantsTools = hasAnySignal(text, TOOL_SIGNALS);
  const wantsAgent = hasAnySignal(text, AGENT_SIGNALS);
  // 需求点名 ollama/本地模型 → 选用 model-ollama；否则用环境默认组件。
  const modelId = resolveModelComponent(text, modelComponent);

  const components: Recipe["components"] = [
    { id: "context-window", version: resolveVersion(catalog, "context-window") },
    { id: modelId, version: resolveVersion(catalog, modelId) },
  ];
  if (wantsTools) {
    components.push({ id: "tool-caller", version: resolveVersion(catalog, "tool-caller") });
  }
  if (wantsAgent) {
    components.push({ id: "agent-single", version: resolveVersion(catalog, "agent-single") });
  }

  // 组合范式：装配 agent 时，各零件（context/model/tools）全部汇入 agent-single 作为 parts；
  // 否则走串行链（context → model）。
  const connections: Recipe["connections"] = wantsAgent
    ? components
        .filter((c) => c.id !== "agent-single")
        .map((c) => ({ from: c.id, to: "agent-single" }))
    : [{ from: "context-window", to: modelId }];

  const parameters: Recipe["parameters"] = {};
  if (wantsAgent) {
    parameters["agent-single"] = {};
  }
  const modelOverride = MODEL_SIGNALS.find(([signal]) => text.includes(signal));
  if (modelOverride) {
    parameters[modelId] = { model: modelOverride[1] };
  }
  const temperatureMatch = text.match(TEMPERATURE_PATTERN);
  if (temperatureMatch) {
    const temperature = Number(temperatureMatch[1]);
    parameters[modelId] = {
      ...parameters[modelId],
      temperature,
    };
  }

  const recipe: Recipe = {
    name: nameFromRequirement(requirement),
    components,
    connections,
    parameters,
  };

  validateStructure(recipe);
  validateParams(recipe, catalog);
  return recipe;
}
