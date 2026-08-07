import { test } from "node:test";
import assert from "node:assert/strict";

import { renderChatPanel } from "../src/panels/chatPanel.ts";
import type { ChatPanelState } from "../src/panels/chatPanel.ts";

test("chat panel renders empty state when no messages", () => {
  const state: ChatPanelState = { messages: [] };
  const html = renderChatPanel(state);

  assert.match(html, /聊天/);
  assert.match(html, /暂无消息/);
  assert.match(html, /message-list/);
  assert.match(html, /chat-input/);
});

test("chat panel renders messages in order", () => {
  const state: ChatPanelState = {
    messages: [
      { role: "user", content: "你好" },
      { role: "assistant", content: "你好，有什么可以帮你？" },
    ],
  };
  const html = renderChatPanel(state);

  assert.match(html, /你好/);
  assert.match(html, /你好，有什么可以帮你？/);
  const userIdx = html.indexOf("你好");
  const assistantIdx = html.indexOf("你好，有什么可以帮你？");
  assert.ok(userIdx < assistantIdx);
});

test("chat panel escapes html in message content", () => {
  const state: ChatPanelState = { messages: [{ role: "user", content: "<script>x</script>" }] };
  const html = renderChatPanel(state);

  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;script&gt;/);
});
