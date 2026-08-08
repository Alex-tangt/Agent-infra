import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { DEFAULT_CATALOG, type ComponentCatalog } from "./catalog.ts";
import { needsClarification, type Answers } from "./clarify.ts";
import {
  readSkillMetadata,
  shouldLoadDesignSkill,
  type SkillMetadata,
} from "./designKnowledge.ts";
import type {
  Acquisition,
  AssemblerDriver,
  SkillReference,
} from "./driver.ts";
import { runAcquire } from "./driver.ts";
import type { Recipe } from "./recipe.ts";
import { requirementToRecipe } from "./requirementToRecipe.ts";
import { resolveModelComponent } from "./signals.ts";

const DEFAULT_SKILL_DIR = new URL("../../skills/agent-design", import.meta.url);
// 起始模板：复用首个已知良好示例（demos/calculator_agent.py），不重复维护模板字符串（ADR-0005 方案 b）。
const DEFAULT_EXAMPLE_URL = new URL("../../demos/calculator_agent.py", import.meta.url);

export interface LocalDriverOptions {
  catalog?: ComponentCatalog;
  skillsDir?: string;
  /** 起始模板文件路径（默认 demos/calculator_agent.py） */
  examplePath?: string;
  /** 默认选用的模型组件（服务启动时由 ASSEMBLER_MODEL_COMPONENT 注入） */
  modelComponent?: string;
}

/** 确定性适配：需求点名 ollama/本地模型 → 模型构造换用 OllamaModel（与 spec 选型信号一致） */
function swapModelToOllama(code: string): string {
  return code
    .replaceAll("OpenAIModel", "OllamaModel")
    .replaceAll('model="gpt-4o-mini"', 'model="llama3"');
}

/** 确定性 demo 代码生成：读已知良好示例作起始模板，按需求做轻量适配，返回代码字符串 */
export function buildLocalDemoCode(
  requirement: string,
  catalog: ComponentCatalog,
  examplePath: string,
  modelComponent: string,
): string {
  const template = readFileSync(examplePath, "utf8");
  let code = template;
  if (resolveModelComponent(requirement.toLowerCase(), modelComponent) === "model-ollama") {
    code = swapModelToOllama(code);
  }
  return code;
}

/**
 * 本地编排驱动：读已知良好示例确定性产 demo 代码 + 瞬态 spec（requirementToRecipe，供生成时校验）。
 * 保留 clarify 流程（web 面板同款）；无模型依赖，开箱即用。
 */
export class LocalDriver implements AssemblerDriver {
  readonly kind = "local" as const;
  private readonly catalog: ComponentCatalog;
  private readonly skillsDir: string;
  private readonly examplePath: string;
  private readonly modelComponent: string;
  private readonly skill: SkillMetadata | undefined;
  private loaded: SkillReference[] = [];

  constructor(options: LocalDriverOptions = {}) {
    this.catalog = options.catalog ?? DEFAULT_CATALOG;
    this.skillsDir = options.skillsDir ?? fileURLToPath(DEFAULT_SKILL_DIR);
    this.examplePath = options.examplePath ?? fileURLToPath(DEFAULT_EXAMPLE_URL);
    this.modelComponent = options.modelComponent ?? "model-openai";
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
      // 本地是确定性转换，prompt 即需求文本本身（skill 只影响 build-note 记录）
      buildPrompt: (text) => text,
      toSkillReference: (skill) => ({ name: skill.name, source: "injected" as const }),
    });
    this.loaded = loaded;
    return acquisition;
  }

  async convert(prompt: string): Promise<string> {
    return buildLocalDemoCode(prompt, this.catalog, this.examplePath, this.modelComponent);
  }

  async spec(prompt: string): Promise<Recipe | null> {
    return requirementToRecipe(prompt, this.catalog, this.modelComponent);
  }

  skillsUsed(): SkillReference[] {
    return this.loaded;
  }
}
