import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

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

// 与 clarify/requirementToRecipe 的领域信号词汇保持一致：单 agent 对话/任务代理
// 与外部工具能力都会命中"单 agent 标配组合"设计知识。
const DESIGN_SIGNALS = [
  "agent",
  "assistant",
  "助手",
  "对话",
  "聊天",
  "chat",
  "机器人",
  "工具",
  "tool",
  "查",
  "搜索",
  "search",
  "查询",
  "天气",
  "weather",
  "计算",
  "calc",
] as const;

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
