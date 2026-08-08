import { fileURLToPath } from "node:url";

import { DEFAULT_CATALOG, type ComponentCatalog } from "./catalog.ts";
import { needsClarification, type Answers } from "./clarify.ts";
import {
  readSkillMetadata,
  shouldLoadDesignSkill,
  skillContextBlock,
  type SkillMetadata,
} from "./designKnowledge.ts";
import type {
  Acquisition,
  AssemblerDriver,
  SkillReference,
} from "./driver.ts";
import { runAcquire } from "./driver.ts";
import { ASSEMBLER_OPERATING_RULES } from "./operatingRules.ts";
import type { Recipe } from "./recipe.ts";
import { requirementToRecipe } from "./requirementToRecipe.ts";
import {
  createStructuredOutputTool,
  type LlmLike,
} from "./structuredOutput.ts";

const DEFAULT_SKILL_DIR = new URL("../../skills/agent-design", import.meta.url);

export interface LocalDriverOptions {
  catalog?: ComponentCatalog;
  skillsDir?: string;
  llm?: LlmLike;
  useLlm?: boolean;
  /** 配方默认选用的模型组件（服务启动时由 ASSEMBLER_MODEL_COMPONENT 注入） */
  modelComponent?: string;
}

function buildLlmPrompt(
  requirement: string,
  skill: SkillMetadata | undefined,
): string {
  const parts = [requirement];
  if (skill) {
    parts.push(skillContextBlock(skill));
  }
  parts.push(ASSEMBLER_OPERATING_RULES);
  return parts.join("\n\n");
}

/**
 * 本地编排驱动：纯函数组合 requirementToRecipe + clarify。
 * 转换默认为确定性转换（web 面板同款），可注入 mock LLM 走结构化输出路径；
 * skill 内容按需注入 prompt（pi 不可用时的等价物）。
 */
export class LocalDriver implements AssemblerDriver {
  readonly kind = "local" as const;
  private readonly catalog: ComponentCatalog;
  private readonly skillsDir: string;
  private readonly llm: LlmLike | undefined;
  private readonly useLlm: boolean;
  private readonly skill: SkillMetadata | undefined;
  private readonly modelComponent: string;
  private loaded: SkillReference[] = [];

  constructor(options: LocalDriverOptions = {}) {
    this.catalog = options.catalog ?? DEFAULT_CATALOG;
    this.skillsDir = options.skillsDir ?? fileURLToPath(DEFAULT_SKILL_DIR);
    this.llm = options.llm;
    this.useLlm = options.useLlm ?? false;
    this.modelComponent = options.modelComponent ?? "model-openai";
    if (this.useLlm && !this.llm) {
      throw new Error("LocalDriver with useLlm: true requires an llm");
    }
    this.skill = this.readSkill();
  }

  private readSkill(): SkillMetadata | undefined {
    try {
      return readSkillMetadata(this.skillsDir);
    } catch {
      return undefined;
    }
  }

  async acquire(requirement: string, answers?: Answers): Promise<Acquisition> {
    // 复用双 driver acquire 公共骨架（澄清判定 → skill 匹配 → prompt 组装）
    const { acquisition, loaded } = runAcquire(requirement, answers, {
      clarify: (text) => needsClarification(text, this.catalog, this.modelComponent),
      matchSkills: (text) =>
        this.skill && shouldLoadDesignSkill(text, this.skill) ? [this.skill] : [],
      buildPrompt: (text, matched) =>
        this.useLlm ? buildLlmPrompt(text, matched[0]) : text,
      toSkillReference: (skill) => ({ name: skill.name, source: "injected" as const }),
    });
    this.loaded = loaded;
    return acquisition;
  }

  async convert(prompt: string): Promise<Recipe> {
    if (this.useLlm) {
      return createStructuredOutputTool(this.llm!, this.catalog).execute(prompt);
    }
    return requirementToRecipe(prompt, this.catalog, this.modelComponent);
  }

  skillsUsed(): SkillReference[] {
    return this.loaded;
  }
}
