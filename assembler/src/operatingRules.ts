// 组装器运行守则：只产配方，写码权限在接线引擎。
// 注入 pi / 本地驱动的 prompt，让模型（或未来的人）明确边界。
export const ASSEMBLER_OPERATING_RULES = [
  "组装器只产出配方 JSON，不写 demo 代码。",
  "不操作组件库文件（components/），写码权限在接线引擎。",
  "输出前用配方 schema 自校验，保证配方合法。",
].join("\n");
