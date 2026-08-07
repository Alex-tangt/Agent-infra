import type { AblationRun, AblationVariant, TelemetrySpan } from "../api/contract.ts";
import type { DemoApi } from "../mockDemoApi.ts";

export interface EvalPanelState {
  run: AblationRun | null;
  pending?: boolean;
}

// 评估入口依赖的接口契约（测试接缝）：与 DemoApi 共享，MockDemoApi 与 DemoApiClient 均满足。
export type EvalApi = Pick<DemoApi, "triggerAblation">;

// 消融会话：把选中的消融变量发给 runner，落地 AblationRun 供展示。
export class EvalSession {
  private run: AblationRun | null = null;
  private pending = false;
  private readonly demoId: string;
  private readonly api: EvalApi;

  constructor(demoId: string, api: EvalApi) {
    this.demoId = demoId;
    this.api = api;
  }

  getState(): EvalPanelState {
    return { run: this.run, pending: this.pending };
  }

  async startRun(variant: AblationVariant): Promise<void> {
    if (this.pending) return;
    this.pending = true;
    try {
      const res = await this.api.triggerAblation(this.demoId, { variant });
      this.run = res.run;
    } finally {
      this.pending = false;
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fmtSpans(spans: TelemetrySpan[]): string {
  if (spans.length === 0) return "spans: 0";
  const components = spans.map((s) => s.componentId).join(", ");
  return `spans: ${spans.length} (${components})`;
}

export function renderEvalPanel(state: EvalPanelState): string {
  const resultsHtml =
    state.run === null || state.run.results.length === 0
      ? '<p class="empty-state">暂无结果。</p>'
      : `<div class="ablation-results-grid">${state.run.results
          .map(
            (r) =>
              `<div class="ablation-result" data-variant-target="${escapeHtml(r.variant.target)}">
  <p class="result-variant">${escapeHtml(r.variant.description)}</p>
  <p class="result-kind">${r.variant.kind} · ${escapeHtml(r.variant.target)}</p>
  <p class="result-scores">${Object.entries(r.scores)
    .map(([k, v]) => `${escapeHtml(k)}=${v}`)
    .join(", ")}</p>
  <p class="result-spans">${fmtSpans(r.spans)}</p>
</div>`,
          )
          .join("")}</div>`;

  const disabled = state.pending ? " disabled" : "";

  return `<section class="panel eval-panel">
  <h2>评估</h2>
  <form class="ablation-form">
    <label>变量类型
      <select name="kind"${disabled}>
        <option value="swap">swap（换组件）</option>
        <option value="remove">remove（删组件）</option>
        <option value="override">override（覆盖参数）</option>
      </select>
    </label>
    <input name="target" type="text" placeholder="目标（如 tools、temperature）"${disabled} />
    <input name="description" type="text" placeholder="描述（如 换掉工具组件）"${disabled} />
    <button type="submit" class="ablation-trigger"${disabled}>触发消融</button>
  </form>
  <div class="ablation-results">${resultsHtml}</div>
</section>`;
}
