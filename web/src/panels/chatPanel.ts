import type { ChatMessage } from "../api/contract.ts";

export interface ChatPanelState {
  messages: ChatMessage[];
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderChatPanel(state: ChatPanelState): string {
  const listHtml =
    state.messages.length === 0
      ? '<p class="empty-state">暂无消息，开始对话吧。</p>'
      : state.messages
          .map(
            (m) =>
              `<div class="message" data-role="${m.role}"><span class="message-role">${m.role}</span><span class="message-content">${escapeHtml(m.content)}</span></div>`,
          )
          .join("");

  return `<section class="panel chat-panel">
  <h2>聊天</h2>
  <div class="message-list">${listHtml}</div>
  <form class="chat-input"><input name="text" type="text" placeholder="输入消息…" /><button type="submit">发送</button></form>
</section>`;
}
