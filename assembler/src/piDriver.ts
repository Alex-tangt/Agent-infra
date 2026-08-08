import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  loadSkillsFromDir,
  SessionManager,
  type CreateAgentSessionOptions,
  type ResourceDiagnostic,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";

import { DEFAULT_CATALOG, type ComponentCatalog } from "./catalog.ts";
import { needsClarification, type Answers } from "./clarify.ts";
import {
  shouldLoadDesignSkill,
  skillContextBlock,
} from "./designKnowledge.ts";
import type { Acquisition, AssemblerDriver, SkillReference } from "./driver.ts";
import { runAcquire } from "./driver.ts";
import { ASSEMBLER_OPERATING_RULES } from "./operatingRules.ts";

const DEFAULT_SKILLS_DIR = fileURLToPath(new URL("../../skills", import.meta.url));
// 首个已知良好示例：pi 会话先 read 它看标准形态（三件套 + 薄容器 + 构造调用 + run()）。
export const DEFAULT_EXAMPLE_PATH = "demos/calculator_agent.py";

export interface PiSession {
  /** 跑完一个回合：把 pi 最后一条 assistant 消息当作 demo 代码返回 */
  run(prompt: string): Promise<string>;
}

export interface RealSessionOptions {
  cwd: string;
  agentDir: string;
  skillsDir: string;
  model?: unknown;
}

export interface PiDriverOptions {
  catalog?: ComponentCatalog;
  skillsDir?: string;
  cwd?: string;
  agentDir?: string;
  model?: unknown;
  /** 示例文件路径（相对 cwd，供 pi 会话 read 看标准形态） */
  examplePath?: string;
  /** 默认选用的模型组件（服务启动时由 ASSEMBLER_MODEL_COMPONENT 注入） */
  modelComponent?: string;
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

/** 剥掉模型可能套的 markdown 代码块围栏（```python ... ```），只留纯 Python 源码 */
export function stripCodeFence(text: string): string {
  const match = /^```(?:python)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/.exec(text.trim());
  return match ? match[1]! : text;
}

/** 组件使用说明块：从 catalog 取各组件 description/class_name + 参数规格，注入 prompt 供模型写码 */
function componentUsageNotes(catalog: ComponentCatalog): string {
  const lines = catalog.components.map((entry) => {
    const params = Object.entries(entry.params)
      .map(([name, spec]) => {
        const bits = [name, `type=${spec.type}`];
        if (spec.enum) {
          bits.push(`enum=[${spec.enum.join(", ")}]`);
        }
        if (spec.default !== undefined && spec.default !== null) {
          bits.push(`default=${JSON.stringify(spec.default)}`);
        }
        return bits.join(", ");
      })
      .join("；");
    const cls = entry.class_name ? `（${entry.class_name}）` : "";
    const desc = entry.description ? `：${entry.description}` : "";
    const paramLine = params.length > 0 ? `\n  参数：${params}` : "";
    return `- ${entry.id}@${entry.version}${cls}${desc}${paramLine}`;
  });
  return ["# 组件使用说明（demo 只允许引用以下注册组件）", ...lines].join("\n");
}

export function buildPiPrompt(
  requirement: string,
  skills: Skill[],
  catalog: ComponentCatalog,
  examplePath: string = DEFAULT_EXAMPLE_PATH,
): string {
  const parts = [requirement];
  for (const skill of skills) {
    parts.push(skillContextBlock(skill));
  }
  parts.push(
    "# 首个已知良好示例\n" +
      `先 read \`${examplePath}\` 查看标准 demo 形态：三件套（模型管理 + 上下文管理 + 工具调用）+ 薄容器（agent-single），` +
      "组件构造调用用关键字参数，最后暴露 run(user_message: str) -> str。以此为标准，按需求改出新的 demo 代码。",
  );
  parts.push(componentUsageNotes(catalog));
  parts.push(ASSEMBLER_OPERATING_RULES);
  return parts.join("\n\n");
}

/**
 * 真实 pi 会话：DefaultResourceLoader 注入仓库 skill（skillsOverride），
 * 只开 read/grep 让模型读示例与组件；跑完回合从最后一条 assistant 消息取 demo 代码。
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
  const { session } = await createAgentSession({
    cwd: options.cwd,
    resourceLoader: loader,
    model: options.model as CreateAgentSessionOptions["model"],
    tools: ["read", "grep"],
    sessionManager: SessionManager.inMemory(options.cwd),
  });

  return {
    async run(prompt: string): Promise<string> {
      await session.sendUserMessage(prompt);
      const code = session.getLastAssistantText();
      if (!code || code.trim() === "") {
        throw new Error("pi session finished without demo code output");
      }
      return stripCodeFence(code);
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
  private readonly examplePath: string;
  private readonly modelComponent: string;
  private readonly createSession: (options: RealSessionOptions) => Promise<PiSession>;
  private readonly skills: Skill[] = [];
  private loaded: SkillReference[] = [];

  constructor(options: PiDriverOptions = {}) {
    this.catalog = options.catalog ?? DEFAULT_CATALOG;
    this.skillsDir = options.skillsDir ?? DEFAULT_SKILLS_DIR;
    this.cwd = options.cwd ?? process.cwd();
    this.agentDir = options.agentDir ?? getAgentDir();
    this.model = options.model;
    this.examplePath = options.examplePath ?? DEFAULT_EXAMPLE_PATH;
    this.modelComponent = options.modelComponent ?? "model-openai";
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
    // 复用双 driver acquire 公共骨架（澄清判定 → skill 匹配 → prompt 组装）
    const { acquisition, loaded } = runAcquire(requirement, answers, {
      clarify: (text) => needsClarification(text, this.catalog, this.modelComponent),
      matchSkills: (text) => this.matchedSkills(text),
      buildPrompt: (text, matched) =>
        buildPiPrompt(text, matched, this.catalog, this.examplePath),
      toSkillReference: (skill) => ({ name: skill.name, source: "pi" as const }),
    });
    this.loaded = loaded;
    return acquisition;
  }

  async convert(prompt: string): Promise<string> {
    const session = await this.createSession({
      cwd: this.cwd,
      agentDir: this.agentDir,
      skillsDir: this.skillsDir,
      model: this.model,
    });
    return session.run(prompt);
  }

  skillsUsed(): SkillReference[] {
    return this.loaded;
  }
}
