import type { Answers } from "./clarify.ts";
import type { Recipe } from "./recipe.ts";

export interface BuildDecision {
  component: string;
  role: string;
  reason: string;
  connections: string[];
  keyParams: Record<string, unknown>;
}

export interface BuildNote {
  requirement: string;
  skillUsed: string | null;
  decisions: BuildDecision[];
  notes: string[];
}

export interface ComposeBuildNoteOptions {
  skills?: Array<{ name: string; source: string }>;
  answers?: Answers;
}

const ROLE_BY_ID: Record<string, string> = {
  "model-openai": "模型管理——LLM 封装，负责模型调用与 tool calling",
  "context-window": "上下文管理——多轮对话窗口与截断策略",
  "tool-caller": "工具调用——外部能力（查询/检索/计算等）的挂载点",
  "agent-single": "组装容器——薄循环容器，编排组件并负责停止条件",
};

const REASON_BY_ID: Record<string, string> = {
  "model-openai": "单体 agent 标配三件套之一：agent = 模型管理 + 上下文管理 + 工具调用（agent-design skill）。",
  "context-window": "单体 agent 标配三件套之一：多轮对话需要上下文窗口保持会话。",
  "agent-single": "需求是单 agent 对话/任务代理：三件套外插进薄容器，容器只负责跑循环、停止、返回。",
};

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

function connectionsFor(recipe: Recipe, id: string): string[] {
  return recipe.connections
    .filter((c) => c.from === id || c.to === id)
    .map((c) => `${c.from} -> ${c.to}`);
}

function toolCallerReason(requirement: string, answers?: Answers): string {
  const text = requirement.toLowerCase();
  if (TOOL_SIGNALS.some((signal) => text.includes(signal))) {
    return "需求包含外部工具能力信号（查/搜索/天气/计算等），挂载对应工具列表。";
  }
  if (answers?.tools && answers.tools.length > 0) {
    return "澄清答案指定了工具列表，为薄容器挂载 tool-caller。";
  }
  return "需求未显式要求工具，但 agent 是薄容器，三件套骨架保留、工具列表留空。";
}

export function composeBuildNote(
  requirement: string,
  recipe: Recipe,
  options: ComposeBuildNoteOptions = {},
): BuildNote {
  const decisions: BuildDecision[] = recipe.components.map((component) => {
    let reason = REASON_BY_ID[component.id] ?? "组件被需求选中并接入配方。";
    if (component.id === "tool-caller") {
      reason = toolCallerReason(requirement, options.answers);
    }
    return {
      component: component.id,
      role: ROLE_BY_ID[component.id] ?? "",
      reason,
      connections: connectionsFor(recipe, component.id),
      keyParams: recipe.parameters[component.id] ?? {},
    };
  });

  const notes: string[] = [];
  if (options.answers) {
    const bits: string[] = [];
    if (options.answers.model) {
      bits.push(`模型 = ${options.answers.model}`);
    }
    if (options.answers.tools && options.answers.tools.length > 0) {
      bits.push(`工具 = ${options.answers.tools.join("、")}`);
    }
    if (bits.length > 0) {
      notes.push(`澄清答案：${bits.join("；")}`);
    }
  }

  return {
    requirement,
    skillUsed: options.skills?.[0]?.name ?? null,
    decisions,
    notes,
  };
}
