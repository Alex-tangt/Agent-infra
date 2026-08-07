import { renderChatPanel } from "./panels/chatPanel.ts";
import type { ChatPanelState } from "./panels/chatPanel.ts";
import { renderDebugPanel } from "./panels/debugPanel.ts";
import type { DebugPanelState } from "./panels/debugPanel.ts";
import { renderEvalPanel } from "./panels/evalPanel.ts";
import type { EvalPanelState } from "./panels/evalPanel.ts";
import { renderAssemblerPanel } from "./panels/assemblerPanel.ts";
import type { AssemblerPanelState } from "./panels/assemblerPanel.ts";

export interface AppState {
  chat: ChatPanelState;
  debug: DebugPanelState;
  eval: EvalPanelState;
  assembler: AssemblerPanelState;
}

export function renderApp(state: AppState): string {
  return `<main class="runtime-ui">
  <header class="runtime-ui-header"><h1>运行界面</h1></header>
  <div class="runtime-ui-panels">
    ${renderChatPanel(state.chat)}
    ${renderDebugPanel(state.debug)}
    ${renderEvalPanel(state.eval)}
    ${renderAssemblerPanel(state.assembler)}
  </div>
</main>`;
}
