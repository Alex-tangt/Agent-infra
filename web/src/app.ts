import { renderChatPanel } from "./panels/chatPanel.ts";
import type { ChatPanelState } from "./panels/chatPanel.ts";
import { renderDebugPanel } from "./panels/debugPanel.ts";
import type { DebugPanelState } from "./panels/debugPanel.ts";
import { renderEvalPanel } from "./panels/evalPanel.ts";
import type { EvalPanelState } from "./panels/evalPanel.ts";
import { renderAssemblerPanel } from "./panels/assemblerPanel.ts";
import type { AssemblerPanelState } from "./panels/assemblerPanel.ts";
import { renderComponentsPanel } from "./panels/componentsPanel.ts";
import type { ComponentsPanelState } from "./panels/componentsPanel.ts";

// 单页 tab 导航：一次显示一个全宽视图；各会话状态保留在 AppState，切换不丢。
export type AppView = "assembler" | "chat" | "debug" | "eval" | "components";

export interface AppState {
  view: AppView;
  chat: ChatPanelState;
  debug: DebugPanelState;
  eval: EvalPanelState;
  assembler: AssemblerPanelState;
  components: ComponentsPanelState;
}

const VIEW_LABELS: Record<AppView, string> = {
  assembler: "组装器",
  chat: "聊天",
  debug: "调试/监测",
  eval: "评估",
  components: "组件库",
};

function renderTabs(view: AppView): string {
  return `<nav class="runtime-ui-tabs">${(Object.keys(VIEW_LABELS) as AppView[])
    .map(
      (key) =>
        `<button type="button" class="runtime-ui-tab${view === key ? " is-active" : ""}" data-view="${key}">${VIEW_LABELS[key]}</button>`,
    )
    .join("")}</nav>`;
}

function renderView(state: AppState): string {
  switch (state.view) {
    case "chat":
      return renderChatPanel(state.chat);
    case "debug":
      return renderDebugPanel(state.debug);
    case "eval":
      return renderEvalPanel(state.eval);
    case "components":
      return renderComponentsPanel(state.components);
    case "assembler":
    default:
      return renderAssemblerPanel(state.assembler);
  }
}

export function renderApp(state: AppState): string {
  return `<main class="runtime-ui">
  <header class="runtime-ui-header"><h1>运行界面</h1></header>
  ${renderTabs(state.view)}
  <div class="runtime-ui-view">${renderView(state)}</div>
</main>`;
}
