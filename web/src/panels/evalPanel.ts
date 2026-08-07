import type { AblationRun } from "../api/contract.ts";

export interface EvalPanelState {
  run: AblationRun | null;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderEvalPanel(state: EvalPanelState): string {
  const resultsHtml =
    state.run === null || state.run.results.length === 0
      ? '<p class="empty-state">暂无结果。</p>'
      : `<ul>${state.run.results
          .map(
            (r) =>
              `<li class="ablation-result" data-variant-target="${escapeHtml(r.variant.target)}">
  <span class="result-variant">${escapeHtml(r.variant.description)}</span>
  <span class="result-scores">${Object.entries(r.scores)
    .map(([k, v]) => `${escapeHtml(k)}=${v}`)
    .join(", ")}</span>
</li>`,
          )
          .join("")}</ul>`;

  return `<section class="panel eval-panel">
  <h2>评估</h2>
  <button type="button" class="ablation-trigger">触发消融</button>
  <div class="ablation-results">${resultsHtml}</div>
</section>`;
}
