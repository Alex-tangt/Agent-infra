import { DEFAULT_CATALOG, requireComponent, type ComponentCatalog } from "./catalog.ts";
import type { Recipe } from "./recipe.ts";
import { validateParams } from "./validate.ts";
import { validateStructure } from "./schema.ts";

const TOOL_SIGNALS = [
  "查",
  "搜索",
  "查询",
  "天气",
  "weather",
  "search",
  "tool",
  "工具",
  "计算",
  "calc",
] as const;

const AGENT_SIGNALS = [
  "agent",
  "助手",
  "assistant",
  "对话",
  "聊天",
  "chat",
  "机器人",
] as const;

const MODEL_SIGNALS: Array<[string, string]> = [
  ["gpt-4o-mini", "gpt-4o-mini"],
  ["gpt-4o", "gpt-4o"],
];

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
): Recipe {
  const text = requirement.toLowerCase();

  const wantsTools = hasAnySignal(text, TOOL_SIGNALS);
  const wantsAgent = hasAnySignal(text, AGENT_SIGNALS);

  const components: Recipe["components"] = [
    { id: "context-window", version: resolveVersion(catalog, "context-window") },
    { id: "model-openai", version: resolveVersion(catalog, "model-openai") },
  ];
  if (wantsTools) {
    components.push({ id: "tool-caller", version: resolveVersion(catalog, "tool-caller") });
  }
  if (wantsAgent) {
    components.push({ id: "agent-single", version: resolveVersion(catalog, "agent-single") });
  }

  const connections: Recipe["connections"] = [
    { from: "context-window", to: "model-openai" },
  ];
  if (wantsTools) {
    connections.push({ from: "model-openai", to: "tool-caller" });
  }

  const parameters: Recipe["parameters"] = {};
  const modelOverride = MODEL_SIGNALS.find(([signal]) => text.includes(signal));
  if (modelOverride) {
    parameters["model-openai"] = { model: modelOverride[1] };
  }
  const temperatureMatch = text.match(TEMPERATURE_PATTERN);
  if (temperatureMatch) {
    const temperature = Number(temperatureMatch[1]);
    parameters["model-openai"] = {
      ...parameters["model-openai"],
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
