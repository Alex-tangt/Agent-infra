// 运行界面 ↔ 组装器服务（assembler/src/server.ts）的语言中立 JSON 契约。
// 服务端复用 A5 编排（acquire → clarify / convert），响应即 assembler 的 AssembleResult。
// 浏览器受 node:fs 限制无法直接 import 组装器，故经服务化入口调用（ADR-0003 第二条边界）。

import type { Recipe } from "./contract.ts";

/** 澄清答案：A3 提问的答复，随需求一并提交（模型选型 / 工具清单） */
export interface Answers {
  model?: string;
  tools?: string[];
}

export interface AssembleRequest {
  requirement: string;
  answers?: Answers;
}

/** 组装器响应：要么问澄清问题（A3），要么产出配方（A2 落地） */
export type AssembleOutcome =
  | { status: "clarify"; questions: string[] }
  | { status: "recipe"; recipe: Recipe };

/** 组装器端口（测试接缝）：MockAssembler 与 AssemblerApiClient 均实现 */
export interface AssemblerPort {
  assemble(requirement: string): Promise<AssembleOutcome>;
  assembleWithAnswers(requirement: string, answers: Answers): Promise<AssembleOutcome>;
}

export const assemblerEndpoints = {
  assemble: "/assemble",
} as const;
