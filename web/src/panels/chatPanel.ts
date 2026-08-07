import type { ChatMessage, ChatReply } from "../api/contract.ts";

// 聊天面板依赖的接口契约（测试接缝）：MockDemoApi 与 DemoApiClient 均满足。
export interface ChatApi {
  sendChat(demoId: string, messages: ChatMessage[]): Promise<ChatReply>;
}

// 一个对话轮次结束时的通知（U3 调试面板用它触发遥测刷新）。
export type ChatTurnListener = (messages: ChatMessage[]) => void;

// 对话会话：维护消息列表与等待状态，发消息 → 等回复 → 记录回复，并通知联动方。
export class ChatSession {
  private messages: ChatMessage[] = [];
  private pending = false;
  private readonly demoId: string;
  private readonly api: ChatApi;
  private readonly onTurn: ChatTurnListener | undefined;

  constructor(demoId: string, api: ChatApi, onTurn?: ChatTurnListener) {
    this.demoId = demoId;
    this.api = api;
    this.onTurn = onTurn;
  }

  getState(): ChatPanelState {
    return { messages: [...this.messages], pending: this.pending };
  }

  async sendMessage(text: string): Promise<void> {
    const content = text.trim();
    if (content === "" || this.pending) return;
    this.messages = [...this.messages, { role: "user", content }];
    this.pending = true;
    try {
      const reply = await this.api.sendChat(this.demoId, [...this.messages]);
      this.messages = [...this.messages, reply.reply];
    } finally {
      this.pending = false;
      this.onTurn?.(this.getState().messages);
    }
  }
}

export interface ChatPanelState {
  messages: ChatMessage[];
  pending?: boolean;
}

type ChatStatus = "idle" | "waiting" | "done";

function statusOf(state: ChatPanelState): ChatStatus {
  if (state.pending) return "waiting";
  if (state.messages.some((m) => m.role === "assistant")) return "done";
  return "idle";
}

function statusText(status: ChatStatus): string {
  switch (status) {
    case "waiting":
      return "正在等待 agent 回复…";
    case "done":
      return "回复完成";
    case "idle":
      return "待输入消息";
  }
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

  const status = statusOf(state);
  const disabled = status === "waiting" ? " disabled" : "";

  return `<section class="panel chat-panel">
  <h2>聊天</h2>
  <p class="chat-status" data-status="${status}">${statusText(status)}</p>
  <div class="message-list">${listHtml}</div>
  <form class="chat-input"><input name="text" type="text" placeholder="输入消息…"${disabled} /><button type="submit"${disabled}>发送</button></form>
</section>`;
}
