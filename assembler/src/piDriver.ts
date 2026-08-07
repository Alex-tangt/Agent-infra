import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  getAgentDir,
  loadSkillsFromDir,
  SessionManager,
  type CreateAgentSessionOptions,
  type ResourceDiagnostic,
  type Skill,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";

import { DEFAULT_CATALOG, type ComponentCatalog } from "./catalog.ts";
import { needsClarification, withAnswers, type Answers } from "./clarify.ts";
import {
  shouldLoadDesignSkill,
  skillContextBlock,
} from "./designKnowledge.ts";
import type { Acquisition, AssemblerDriver, SkillReference } from "./driver.ts";
import { ASSEMBLER_OPERATING_RULES } from "./operatingRules.ts";
import type { Recipe } from "./recipe.ts";
import {
  constrainToRecipe,
  RECIPE_PARAMS_SCHEMA,
} from "./structuredOutput.ts";

const DEFAULT_SKILLS_DIR = fileURLToPath(new URL("../../skills", import.meta.url));

export interface PiSession {
  run(prompt: string): Promise<Recipe>;
}

export interface RealSessionOptions {
  cwd: string;
  agentDir: string;
  skillsDir: string;
  catalog: ComponentCatalog;
  model?: unknown;
}

export interface PiDriverOptions {
  catalog?: ComponentCatalog;
  skillsDir?: string;
  cwd?: string;
  agentDir?: string;
  model?: unknown;
  createSession?: (options: RealSessionOptions) => Promise<PiSession>;
}

/**
 * 用 pi 的原生 skill 扫描（loadSkillsFromDir）加载仓库 skills/ 目录，
 * 产出可注入 DefaultResourceLoader skillsOverride 的 skill 列表。
 */
export function buildSkillOverrides(skillsDir: string): Skill[] {
  const { skills } = loadSkillsFromDir({ dir: skillsDir, source: "agent-design" });
  return skills;
}

/**
 * 把仓库 skill 追加进 pi 资源加载器已扫描的 skill 列表（渐进式披露的注入点）。
 */
export function mergeSkillOverrides(repo: Skill[]) {
  return (base: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => ({
    skills: [...base.skills, ...repo],
    diagnostics: base.diagnostics,
  });
}

/**
 * pi 原生结构化输出工具：模型以 structured_output 工具调用收尾（terminate），
 * 参数即配方 JSON；产出前用配方契约 schema + catalog 自校验。
 */
export function buildStructuredOutputTool(
  catalog: ComponentCatalog,
): ToolDefinition<typeof RECIPE_PARAMS_SCHEMA, Recipe> {
  return defineTool({
    name: "structured_output",
    label: "Structured Output (Recipe)",
    description:
      "Return the final recipe as a single JSON object conforming to the recipe schema. Use this as the last action; the output is validated and returned as a Recipe.",
    promptSnippet: "Emit the final recipe as a terminating structured_output call",
    promptGuidelines: [
      "Use structured_output as your final action to emit the recipe JSON.",
      "The recipe must reference only components from the catalog and pass schema validation.",
    ],
    parameters: RECIPE_PARAMS_SCHEMA,
    async execute(_toolCallId: string, params) {
      const recipe = constrainToRecipe(JSON.stringify(params), catalog);
      return {
        content: [{ type: "text", text: `Recipe produced: ${recipe.name}` }],
        details: recipe,
        terminate: true,
      };
    },
  });
}

function buildPiPrompt(requirement: string, skills: Skill[]): string {
  const parts = [requirement];
  for (const skill of skills) {
    parts.push(skillContextBlock(skill));
  }
  parts.push(
    "最后一步必须调用 structured_output 工具，把配方作为其参数返回；" +
      "需求匹配设计知识 skill 时，先用 read 读完整 SKILL.md。",
  );
  parts.push(ASSEMBLER_OPERATING_RULES);
  return parts.join("\n\n");
}

/**
 * 真实 pi 会话：DefaultResourceLoader 注入仓库 skill（skillsOverride），
 * customTools 挂 structured_output；跑完回合后从 tool_execution_end 事件取配方。
 */
export async function createRealPiSession(
  options: RealSessionOptions,
): Promise<PiSession> {
  const repoSkills = buildSkillOverrides(options.skillsDir);
  const loader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir,
    skillsOverride: mergeSkillOverrides(repoSkills),
  });
  const tool = buildStructuredOutputTool(options.catalog);
  const { session } = await createAgentSession({
    cwd: options.cwd,
    resourceLoader: loader,
    model: options.model as CreateAgentSessionOptions["model"],
    tools: ["read", "grep"],
    customTools: [tool as unknown as ToolDefinition],
    sessionManager: SessionManager.inMemory(options.cwd),
  });

  return {
    async run(prompt: string): Promise<Recipe> {
      let recipe: unknown;
      const unsubscribe = session.subscribe((event) => {
        if (
          event.type === "tool_execution_end" &&
          event.toolName === "structured_output"
        ) {
          recipe = event.result?.details;
        }
      });
      try {
        await session.sendUserMessage(prompt);
      } finally {
        unsubscribe();
      }
      if (!recipe) {
        throw new Error("pi session finished without a structured_output recipe");
      }
      return constrainToRecipe(JSON.stringify(recipe), options.catalog);
    },
  };
}

export class PiDriver implements AssemblerDriver {
  readonly kind = "pi" as const;
  private readonly catalog: ComponentCatalog;
  private readonly skillsDir: string;
  private readonly cwd: string;
  private readonly agentDir: string;
  private readonly model: unknown;
  private readonly createSession: (options: RealSessionOptions) => Promise<PiSession>;
  private readonly skills: Skill[] = [];
  private loaded: SkillReference[] = [];

  constructor(options: PiDriverOptions = {}) {
    this.catalog = options.catalog ?? DEFAULT_CATALOG;
    this.skillsDir = options.skillsDir ?? DEFAULT_SKILLS_DIR;
    this.cwd = options.cwd ?? process.cwd();
    this.agentDir = options.agentDir ?? getAgentDir();
    this.model = options.model;
    this.createSession = options.createSession ?? createRealPiSession;
    try {
      this.skills = buildSkillOverrides(this.skillsDir);
    } catch {
      this.skills = [];
    }
  }

  private matchedSkills(text: string): Skill[] {
    return this.skills.filter((skill) => shouldLoadDesignSkill(text, skill));
  }

  async acquire(requirement: string, answers?: Answers): Promise<Acquisition> {
    const text = answers ? withAnswers(requirement, answers) : requirement;
    const questions = needsClarification(text, this.catalog);
    if (questions.length > 0) {
      this.loaded = [];
      return { status: "clarify", questions };
    }
    this.loaded = this.matchedSkills(text).map((skill) => ({
      name: skill.name,
      source: "pi" as const,
    }));
    return {
      status: "ready",
      prompt: buildPiPrompt(text, this.matchedSkills(text)),
    };
  }

  async convert(prompt: string): Promise<Recipe> {
    const session = await this.createSession({
      cwd: this.cwd,
      agentDir: this.agentDir,
      skillsDir: this.skillsDir,
      catalog: this.catalog,
      model: this.model,
    });
    return session.run(prompt);
  }

  skillsUsed(): SkillReference[] {
    return this.loaded;
  }
}
