import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseSkillFrontmatter,
  readSkillMetadata,
  shouldLoadDesignSkill,
  skillContextBlock,
} from "../src/designKnowledge.ts";

function makeSkillDir(
  name: string,
  description: string,
  body = "设计知识正文",
): string {
  const dir = mkdtempSync(join(tmpdir(), "design-knowledge-"));
  const frontmatter = `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`;
  writeFileSync(join(dir, "SKILL.md"), frontmatter, "utf8");
  return dir;
}

test("designKnowledge: parseSkillFrontmatter extracts name and description", () => {
  const raw = `---
name: agent-design
description: 组装器设计知识：单 agent 标配组合模式。
---

# 正文`;
  const front = parseSkillFrontmatter(raw);

  assert.equal(front.name, "agent-design");
  assert.match(front.description!, /单 agent 标配组合/);
});

test("designKnowledge: readSkillMetadata reads a skill dir's SKILL.md", () => {
  const dir = makeSkillDir("agent-design", "组装器设计知识：组件、连线、配方。");

  const meta = readSkillMetadata(dir);

  assert.equal(meta.name, "agent-design");
  assert.match(meta.description, /组件/);
  assert.equal(meta.baseDir, dir);
  assert.equal(meta.filePath, join(dir, "SKILL.md"));
  rmSync(dir, { recursive: true, force: true });
});

test("designKnowledge: an agent-like requirement should load the design skill", () => {
  const meta = readSkillMetadata(join(process.cwd(), "..", "skills", "agent-design"));

  assert.equal(shouldLoadDesignSkill("帮我做一个会查天气的聊天 agent", meta), true);
});

test("designKnowledge: a non-agent requirement should not load the design skill", () => {
  const meta = readSkillMetadata(join(process.cwd(), "..", "skills", "agent-design"));

  assert.equal(shouldLoadDesignSkill("帮我写一个 python 排序脚本", meta), false);
});

test("designKnowledge: a non-design skill is never loaded on-demand", () => {
  const skill = {
    name: "git-workflow",
    description: "git 提交流程规范，指导提交信息格式。",
    filePath: "skills/git-workflow/SKILL.md",
    baseDir: "skills/git-workflow",
  };

  assert.equal(shouldLoadDesignSkill("做个聊天机器人", skill), false);
});

test("designKnowledge: skillContextBlock inlines name and description", () => {
  const skill = {
    name: "agent-design",
    description: "单 agent 标配组合",
    filePath: "skills/agent-design/SKILL.md",
    baseDir: "skills/agent-design",
  };

  const block = skillContextBlock(skill);

  assert.match(block, /agent-design/);
  assert.match(block, /单 agent 标配组合/);
});
