import type { TelemetrySpan } from "../api/contract.ts";

export interface DebugPanelState {
  spans: TelemetrySpan[];
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fmtTokens(span: TelemetrySpan): string {
  if (!span.tokenUsage) return "-";
  return `↑${span.tokenUsage.input} ↓${span.tokenUsage.output}`;
}

export function renderDebugPanel(state: DebugPanelState): string {
  const listHtml =
    state.spans.length === 0
      ? '<p class="empty-state">暂无遥测数据。</p>'
      : `<ul>${state.spans
          .map(
            (s) =>
              `<li class="span" data-span-id="${escapeHtml(s.id)}">
  <span class="span-component">${escapeHtml(s.componentId)}</span>
  <span class="span-op">${escapeHtml(s.operation)}</span>
  <span class="span-duration">${s.durationMs}ms</span>
  <span class="span-tokens">${fmtTokens(s)}</span>
  <span class="span-status">${s.status}</span>
</li>`,
          )
          .join("")}</ul>`;

  return `<section class="panel debug-panel">
  <h2>调试 / 监测</h2>
  <div class="span-list">${listHtml}</div>
</section>`;
}
