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
  | {
      status: "recipe";
      /** demo 代码（Python 源码字符串）：唯一真相源 */
      code: string;
      /** 瞬态 spec：生成时校验用，可 null；不持久、不追代码、非真相源 */
      spec: Recipe | null;
      buildNote: BuildNote;
    };

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

  // 转换：需求文本 → demo 代码（代码是唯一真相源）
  const code = await driver.convert(acquisition.prompt);

  // 瞬态 spec：驱动可产可空；校验失败不阻塞代码产出（最终以代码为准，spec 只是生成时参考）
  let spec: Recipe | null = null;
  if (driver.spec) {
    try {
      const candidate = await driver.spec(acquisition.prompt);
      if (candidate) {
        validateStructure(candidate);
        validateParams(candidate, catalog);
      }
      spec = candidate;
    } catch {
      spec = null;
    }
  }

  // 组装记录：选了什么组件、为什么这么连、关键参数 + 澄清答案
  const buildNote = composeBuildNote(requirement, spec, {
    answers,
    skills: driver.skillsUsed(),
  });

  return { status: "recipe", code, spec, buildNote };
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
