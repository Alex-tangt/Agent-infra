import type { Answers } from "./clarify.ts";
import type { Recipe } from "./recipe.ts";

export type DriverKind = "pi" | "local";

export type Acquisition =
  | { status: "clarify"; questions: string[] }
  | { status: "ready"; prompt: string };

export interface SkillReference {
  name: string;
  source: "pi" | "injected";
}

/**
 * 组装器编排的对话驱动接缝：采集（需求输入）→ 澄清（是否缺信息）
 * → 转换（需求文本 → 配方）。pi 驱动走 pi 会话 + 原生 skill 加载；
 * 本地驱动走确定性转换 + prompt 注入，测试用 mock 驱动替换。
 */
export interface AssemblerDriver {
  readonly kind: DriverKind;
  acquire(requirement: string, answers?: Answers): Promise<Acquisition>;
  convert(prompt: string): Promise<Recipe>;
  skillsUsed(): SkillReference[];
}
