import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AGENT_SIGNALS,
  CONCRETE_MODEL_SIGNALS,
  CONCRETE_TOOL_SIGNALS,
  DESIGN_SIGNALS,
  GENERIC_TOOL_SIGNALS,
  MODEL_INTENT_SIGNALS,
  TOOL_SIGNALS,
} from "../src/signals.ts";

function hits(text: string, signals: readonly string[]): boolean {
  return signals.some((signal) => text.includes(signal));
}

test("signals: TOOL_SIGNALS 是泛化与具体工具信号的全集（无重复词）", () => {
  assert.equal(new Set(TOOL_SIGNALS).size, TOOL_SIGNALS.length);
  for (const generic of GENERIC_TOOL_SIGNALS) {
    assert.ok(TOOL_SIGNALS.includes(generic), `泛化信号 ${generic} 应在全集中`);
  }
  for (const concrete of CONCRETE_TOOL_SIGNALS) {
    assert.ok(TOOL_SIGNALS.includes(concrete), `具体信号 ${concrete} 应在全集中`);
  }
  assert.deepEqual(
    [...new Set([...GENERIC_TOOL_SIGNALS, ...CONCRETE_TOOL_SIGNALS])].sort(),
    [...TOOL_SIGNALS].sort(),
  );
});

test("signals: DESIGN_SIGNALS 是 agent 信号与工具信号的并集", () => {
  assert.deepEqual(
    [...new Set([...AGENT_SIGNALS, ...TOOL_SIGNALS])].sort(),
    [...DESIGN_SIGNALS].sort(),
  );
});

test("signals: A2/A3 对同一信号词判定语义一致——'工具'命中泛化而非具体工具", () => {
  const vague = "做一个带工具的 agent";
  assert.ok(hits(vague, TOOL_SIGNALS), "A2：泛化工具词也判定为需要工具");
  assert.ok(hits(vague, GENERIC_TOOL_SIGNALS));
  assert.ok(!hits(vague, CONCRETE_TOOL_SIGNALS), "A3：未点名具体工具 → 需要澄清");
});

test("signals: 点名具体工具能力时 A3 不再因工具发起澄清", () => {
  const concrete = "用 gpt-4o 做一个会查天气的 agent";
  assert.ok(hits(concrete, TOOL_SIGNALS));
  assert.ok(hits(concrete, CONCRETE_TOOL_SIGNALS));
  assert.ok(!hits(concrete, GENERIC_TOOL_SIGNALS));
});

test("signals: 单 agent 信号命中对话/聊天/机器人需求（A2 判定 agent-single）", () => {
  assert.ok(hits("帮我做个能对话的聊天机器人", AGENT_SIGNALS));
});

test("signals: 具体模型信号即 A2 模型参数覆盖的型号清单", () => {
  assert.deepEqual([...CONCRETE_MODEL_SIGNALS], ["gpt-4o-mini", "gpt-4o"]);
});

test("signals: 模型意图信号命中'模型'一词（A3 发起选型澄清）", () => {
  assert.ok(hits("用哪个模型做 agent", MODEL_INTENT_SIGNALS));
});
