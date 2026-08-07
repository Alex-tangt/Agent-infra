import type { Answers } from "./clarify.ts";
import { composeBuildNote, type BuildNote } from "./buildNote.ts";
import { DEFAULT_CATALOG, type ComponentCatalog } from "./catalog.ts";
import type { AssemblerDriver } from "./driver.ts";
import { LocalDriver } from "./localDriver.ts";
import type { Recipe } from "./recipe.ts";
import { validateStructure } from "./schema.ts";
import { validateParams } from "./validate.ts";

export interface AssembleDeps {
  driver?: AssemblerDriver;
  catalog?: ComponentCatalog;
}

export type AssembleResult =
  | { status: "clarify"; questions: string[] }
  | { status: "recipe"; recipe: Recipe; buildNote: BuildNote };

async function runFlow(
  requirement: string,
  answers: Answers | undefined,
  deps: AssembleDeps,
): Promise<AssembleResult> {
  const catalog = deps.catalog ?? DEFAULT_CATALOG;
  const driver = deps.driver ?? (await createDefaultDriver());

  // 采集 + 澄清：需求是否足够明确
  const acquisition = await driver.acquire(requirement, answers);
  if (acquisition.status === "clarify") {
    return { status: "clarify", questions: acquisition.questions };
  }

  // 转换：需求文本 → 配方
  const recipe = await driver.convert(acquisition.prompt);

  // 输出：配方 JSON 自校验（结构 + 参数），不合法不产出
  validateStructure(recipe);
  validateParams(recipe, catalog);

  // 组装记录：选了什么组件、为什么这么连、关键参数 + 澄清答案
  const buildNote = composeBuildNote(requirement, recipe, {
    answers,
    skills: driver.skillsUsed(),
  });

  return { status: "recipe", recipe, buildNote };
}

export async function assembleRequirement(
  requirement: string,
  deps: AssembleDeps = {},
): Promise<AssembleResult> {
  return runFlow(requirement, undefined, deps);
}

export async function assembleWithAnswers(
  requirement: string,
  answers: Answers,
  deps: AssembleDeps = {},
): Promise<AssembleResult> {
  return runFlow(requirement, answers, deps);
}

/**
 * 默认驱动：pi 可用则走 pi 会话 + 原生 skill 加载；否则退化为本地确定性编排。
 */
export async function createDefaultDriver(): Promise<AssemblerDriver> {
  try {
    const { PiDriver } = await import("./piDriver.ts");
    return new PiDriver();
  } catch {
    return new LocalDriver();
  }
}
