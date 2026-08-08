// 运行界面 ↔ 组装器服务（assembler/src/server.ts）的语言中立 JSON 契约。
// 服务端复用 A5 编排（acquire → clarify / convert），响应即 assembler 的 AssembleResult。
// 浏览器受 node:fs 限制无法直接 import 组装器，故经服务化入口调用（ADR-0003 第二条边界）。
// ADR-0005：组装器直接产出 demo 代码（唯一真相源），spec 只是生成时校验的瞬态参考。

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

/** 组装记录（build-note）：导出时物化"为什么这么选"的决策日志，纯信任文档，不作真相源。 */
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

/** 组装器响应：要么问澄清问题（A3），要么产出 demo 代码（A2 落地，ADR-0005 代码即真相源）。 */
export type AssembleOutcome =
  | { status: "clarify"; questions: string[] }
  | {
      status: "recipe";
      /** demo 代码（Python 源码字符串）：唯一真相源 */
      code: string;
      /** 瞬态 spec：仅作生成时校验与写码参考，可 null，不持久、非真相源 */
      spec: Recipe | null;
      buildNote: BuildNote;
    };

/** 组装器端口（测试接缝）：MockAssembler 与 AssemblerApiClient 均实现 */
export interface AssemblerPort {
  assemble(requirement: string): Promise<AssembleOutcome>;
  assembleWithAnswers(requirement: string, answers: Answers): Promise<AssembleOutcome>;
}

export const assemblerEndpoints = {
  assemble: "/assemble",
} as const;
