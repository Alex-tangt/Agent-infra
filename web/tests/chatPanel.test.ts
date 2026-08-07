import { test } from "node:test";
import assert from "node:assert/strict";

import { renderChatPanel, ChatSession } from "../src/panels/chatPanel.ts";
import type { ChatPanelState, ChatApi } from "../src/panels/chatPanel.ts";
import type { ChatMessage, ChatReply } from "../src/api/contract.ts";
import { MockDemoApi } from "../src/mockDemoApi.ts";

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

test("chat panel renders waiting state with disabled input", () => {
  const html = renderChatPanel({
    messages: [{ role: "user", content: "hi" }],
    pending: true,
  });

  assert.match(html, /data-status="waiting"/);
  assert.match(html, /等待/);
  assert.match(html, /disabled/);
});

test("chat panel renders done state once a reply has landed", () => {
  const html = renderChatPanel({
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hi back" },
    ],
  });

  assert.match(html, /data-status="done"/);
  assert.ok(!html.includes("disabled"));
});

test("chat session sends message to api and records user and assistant turns", async () => {
  const api = new MockDemoApi();
  const session = new ChatSession("demo-x", api);

  await session.sendMessage("你好");

  const state = session.getState();
  assert.equal(state.messages.length, 2);
  assert.deepEqual(state.messages[0], { role: "user", content: "你好" });
  assert.equal(state.messages[1]!.role, "assistant");
  assert.ok(state.messages[1]!.content.length > 0);
});

test("chat session exposes waiting state while reply is in flight", async () => {
  let resolveReply!: (reply: ChatReply) => void;
  const api: ChatApi = {
    sendChat: () =>
      new Promise<ChatReply>((resolve) => {
        resolveReply = resolve;
      }),
  };
  const session = new ChatSession("demo-x", api);

  const inFlight = session.sendMessage("hi");

  assert.equal(session.getState().pending, true);

  resolveReply({ reply: { role: "assistant", content: "hi back" } });
  await inFlight;

  const state = session.getState();
  assert.equal(state.pending, false);
  assert.deepEqual(state.messages[1], { role: "assistant", content: "hi back" });
});

test("chat session notifies a listener when a turn completes", async () => {
  const api = new MockDemoApi();
  const turns: ChatMessage[][] = [];
  const session = new ChatSession("demo-x", api, (messages) => turns.push(messages));

  await session.sendMessage("hi");

  assert.equal(turns.length, 1);
  assert.equal(turns[0]!.length, 2);
  assert.deepEqual(turns[0]![0], { role: "user", content: "hi" });
});

test("chat session ignores blank messages and re-entrant sends", async () => {
  let calls = 0;
  const api: ChatApi = {
    sendChat: async () => {
      calls += 1;
      return { reply: { role: "assistant", content: "ok" } };
    },
  };
  const session = new ChatSession("demo-x", api);

  await session.sendMessage("   ");
  assert.equal(calls, 0);
  assert.equal(session.getState().messages.length, 0);
});
