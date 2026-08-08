// 领域信号词汇单一来源（A2 需求→配方 / A3 澄清 / A5 组装器编排共享）：
// 需求文本 → 组件选型与澄清判定的判定词统一在此定义，
// 消除 requirementToRecipe/buildNote/designKnowledge/clarify 的重复定义（Divergent Change 风险）。
// 语义约定（A2/A3 必须一致，禁止同一词两边判定相反）：
// - A2 用 TOOL_SIGNALS / AGENT_SIGNALS 判定组件选型；
// - A3 用 GENERIC/CONCRETE 拆分的同一组词判定"是否点名具体能力"，
//   泛化词（只提"工具"）→ 需要澄清；具体词（查/搜索/天气…）→ 免澄清。

/** 泛化工具信号：只提"工具"而未点名具体能力 → A3 需要澄清工具清单 */
export const GENERIC_TOOL_SIGNALS = ["工具", "tool"] as const;

/** 具体工具信号：点名具体工具能力（查/搜索/天气/计算等） */
export const CONCRETE_TOOL_SIGNALS = [
  "查",
  "搜索",
  "查询",
  "天气",
  "weather",
  "search",
  "计算",
  "calc",
] as const;

/** 工具信号全集：需求命中任一 → A2 判定需要 tool-caller（buildNote 的挂载理由同源） */
export const TOOL_SIGNALS = [...GENERIC_TOOL_SIGNALS, ...CONCRETE_TOOL_SIGNALS] as const;

/** 单 agent 信号：需求命中任一 → A2 判定需要 agent-single */
export const AGENT_SIGNALS = [
  "agent",
  "助手",
  "assistant",
  "对话",
  "聊天",
  "chat",
  "机器人",
] as const;

/** 设计知识信号：agent 或工具需求都会命中"单 agent 标配组合"设计知识 */
export const DESIGN_SIGNALS = [...AGENT_SIGNALS, ...TOOL_SIGNALS] as const;

/** 模型意图信号：提及模型但未点名具体型号 → A3 需要澄清选型 */
export const MODEL_INTENT_SIGNALS = ["模型", "model"] as const;

/** 具体模型信号：点名具体型号（A2 模型参数覆盖 / A3 免澄清） */
export const CONCRETE_MODEL_SIGNALS = ["gpt-4o-mini", "gpt-4o"] as const;

/** 本地 ollama 模型信号：点名本地模型实现 → A2 选用 model-ollama 组件 */
export const OLLAMA_MODEL_SIGNALS = ["ollama", "本地模型"] as const;

/**
 * 模型组件选型单一来源：需求点名本地 ollama → model-ollama；
 * 否则用环境默认（组装器服务经 ASSEMBLER_MODEL_COMPONENT 注入）。
 */
export function resolveModelComponent(
  text: string,
  fallback = "model-openai",
): string {
  return hasAnySignal(text, OLLAMA_MODEL_SIGNALS) ? "model-ollama" : fallback;
}

function hasAnySignal(text: string, signals: readonly string[]): boolean {
  return signals.some((signal) => text.includes(signal));
}
