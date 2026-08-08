import { withAnswers, type Answers } from "./clarify.ts";
import type { Recipe } from "./recipe.ts";

export type DriverKind = "pi" | "local";

export type Acquisition =
  | { status: "clarify"; questions: string[] }
  | { status: "ready"; prompt: string };

export interface SkillReference {
  name: string;
  source: "pi" | "injected";
}

/** acquire 公共骨架的定制点：澄清判定 / skill 需求匹配 / prompt 组装 / 组装记录映射 */
export interface AcquireHooks<TMatch> {
  /** 澄清判定：返回需要向用户澄清的问题（空数组 = 需求足够明确） */
  clarify(text: string): string[];
  /** 需求匹配：返回命中哪些 skill（空 = 不加载 skill） */
  matchSkills(text: string): TMatch[];
  /** prompt 组装：把匹配结果注入需求文本 */
  buildPrompt(text: string, matched: TMatch[]): string;
  /** 匹配结果 → 组装记录（build-note）里的 skill 引用 */
  toSkillReference(matched: TMatch): SkillReference;
}

/**
 * 双 driver acquire 公共骨架：澄清判定 → skill 需求匹配 → prompt 组装。
 * pi 与 local 驱动只定制 hooks（skill 来源 / prompt 风格），流程结构不再各自重复。
 * 返回采集结果 + 本次加载的 skill 引用（记录进组装记录）。
 */
export function runAcquire<TMatch = SkillReference>(
  requirement: string,
  answers: Answers | undefined,
  hooks: AcquireHooks<TMatch>,
): { acquisition: Acquisition; loaded: SkillReference[] } {
  const text = answers ? withAnswers(requirement, answers) : requirement;
  const questions = hooks.clarify(text);
  if (questions.length > 0) {
    return { acquisition: { status: "clarify", questions }, loaded: [] };
  }
  const matched = hooks.matchSkills(text);
  return {
    acquisition: { status: "ready", prompt: hooks.buildPrompt(text, matched) },
    loaded: matched.map(hooks.toSkillReference),
  };
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
