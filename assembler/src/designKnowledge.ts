import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { AGENT_SIGNALS, TOOL_SIGNALS } from "./signals.ts";

export interface SkillMetadata {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
}

export interface SkillFrontmatter {
  name?: string;
  description?: string;
}

export function parseSkillFrontmatter(raw: string): SkillFrontmatter {
  const match = /^---\n([\s\S]*?)\n---/.exec(raw);
  if (!match) {
    return {};
  }
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const kv = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line);
    if (kv) {
      fields[kv[1]!] = kv[2]!.trim();
    }
  }
  return { name: fields["name"], description: fields["description"] };
}

export function readSkillMetadata(skillDir: string): SkillMetadata {
  const filePath = join(skillDir, "SKILL.md");
  const raw = readFileSync(filePath, "utf8");
  const front = parseSkillFrontmatter(raw);
  return {
    name: front.name ?? basename(skillDir),
    description: front.description ?? "",
    filePath,
    baseDir: skillDir,
  };
}

// 设计知识匹配信号 = 单 agent 信号 ∪ 工具信号（单一来源 signals.ts）：
// 单 agent 对话/任务代理与外部工具能力都会命中"单 agent 标配组合"设计知识。
const DESIGN_SIGNALS = [...AGENT_SIGNALS, ...TOOL_SIGNALS] as const;

const DESIGN_SKILL_MARKERS = /(组件|组装|组合|连线|配方)/;

export function shouldLoadDesignSkill(
  requirement: string,
  skill: SkillMetadata,
): boolean {
  const text = requirement.toLowerCase();
  const matchesRequirement = DESIGN_SIGNALS.some((signal) => text.includes(signal));
  if (!matchesRequirement) {
    return false;
  }
  return DESIGN_SKILL_MARKERS.test(skill.description);
}

export function skillContextBlock(skill: SkillMetadata): string {
  return `# 设计知识 skill: ${skill.name}\n\n${skill.description}`;
}
