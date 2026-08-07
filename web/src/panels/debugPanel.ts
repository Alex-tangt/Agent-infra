import type { TelemetrySpan, TokenUsage } from "../api/contract.ts";

export interface DebugPanelState {
  spans: TelemetrySpan[];
}

// 组件粒度遥测（对齐监测系统语义：每组件耗时、调用次数、token 消耗）。
export interface ComponentTelemetry {
  componentId: string;
  // 该组件出现的 gen_ai.operation.name（同一组件可能执行多种操作）。
  operations: string[];
  callCount: number;
  totalDurationMs: number;
  // 该组件全部 span 的 token 汇总；没有任何 span 携带 tokenUsage 时为 null。
  tokens: TokenUsage | null;
}

// 按组件粒度聚合 spans：调用次数累加、耗时累加、token 累加，输出按组件名排序。
export function aggregateTelemetry(spans: TelemetrySpan[]): ComponentTelemetry[] {
  const byComponent = new Map<string, ComponentTelemetry>();
  for (const span of spans) {
    let agg = byComponent.get(span.componentId);
    if (!agg) {
      agg = {
        componentId: span.componentId,
        operations: [],
        callCount: 0,
        totalDurationMs: 0,
        tokens: null,
      };
      byComponent.set(span.componentId, agg);
    }
    if (!agg.operations.includes(span.operation)) agg.operations.push(span.operation);
    agg.callCount += 1;
    agg.totalDurationMs += span.durationMs;
    if (span.tokenUsage) {
      agg.tokens = {
        input: (agg.tokens?.input ?? 0) + span.tokenUsage.input,
        output: (agg.tokens?.output ?? 0) + span.tokenUsage.output,
      };
    }
  }
  return [...byComponent.values()].sort((a, b) => a.componentId.localeCompare(b.componentId));
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fmtTokens(tokens: TokenUsage | null): string {
  if (!tokens) return "-";
  return `↑${tokens.input} ↓${tokens.output}`;
}

// 展示字段对齐 OTel GenAI semconv：gen_ai.operation.name、gen_ai.usage.input/output_tokens。
function renderComponentRows(components: ComponentTelemetry[]): string {
  if (components.length === 0) return '<p class="empty-state">暂无遥测数据。</p>';
  return `<table class="component-table">
  <thead>
    <tr>
      <th>组件</th>
      <th>操作</th>
      <th>调用次数</th>
      <th>总耗时</th>
      <th>Token</th>
    </tr>
  </thead>
  <tbody>
    ${components
      .map(
        (c) => `<tr class="component-row" data-component-id="${escapeHtml(c.componentId)}">
  <td class="component-name">${escapeHtml(c.componentId)}</td>
  <td class="component-ops" data-gen-ai-operation-name="${escapeHtml(c.operations.join(", "))}">${escapeHtml(c.operations.join(", "))}</td>
  <td class="component-calls">${c.callCount}</td>
  <td class="component-duration">${c.totalDurationMs}ms</td>
  <td class="component-tokens" data-gen-ai-usage-input-tokens="${c.tokens?.input ?? ""}" data-gen-ai-usage-output-tokens="${c.tokens?.output ?? ""}">${fmtTokens(c.tokens)}</td>
</tr>`,
      )
      .join("")}
  </tbody>
</table>`;
}

export function renderDebugPanel(state: DebugPanelState): string {
  return `<section class="panel debug-panel">
  <h2>调试 / 监测</h2>
  <div class="span-list">${renderComponentRows(aggregateTelemetry(state.spans))}</div>
</section>`;
}
