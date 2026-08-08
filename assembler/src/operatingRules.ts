// 组装器运行守则：组装器（coding agent）直接产 demo 代码，代码是唯一真相源（ADR-0005）。
// 注入 pi 驱动的 prompt，让模型明确产出边界：只写代码、只引用注册组件、关键字参数构造、暴露 run()。
export const ASSEMBLER_OPERATING_RULES = [
  "只产出 demo 代码（Python 源码字符串），不产出配方 JSON，不改组件库文件（components/）。",
  "只引用注册组件：model-openai / model-ollama / context-window / tool-caller / agent-single（及示例里配套的 Tool、register_* 辅助符号）。",
  "组件构造调用一律用关键字参数，例如 ContextWindow(max_rounds=5, strategy=\"truncate\")。",
  "demo 必须暴露 run(user_message: str) -> str，内部调用组装好的 agent 完成一轮对话。",
  "结束信号：把完整 demo 代码作为最后一条 assistant 消息直接输出；不要用工具调用包裹、不要用代码块包裹、不要输出 JSON。",
].join("\n");
