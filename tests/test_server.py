import json
import threading
import urllib.error
import urllib.request
from types import SimpleNamespace

import pytest

from components import reset
from server.app import build_app
from server.runtime import RuntimeUI

TOOL_REQUEST = json.dumps({"tool": "add", "arguments": {"a": 2, "b": 3}})
MODEL_REPLIES = [TOOL_REQUEST, "the answer is 5"]

CALCULATOR_RECIPE = {
    "name": "calculator-agent",
    "components": [
        {"id": "context-window", "version": "1.0"},
        {"id": "model-openai", "version": "1.0"},
        {"id": "tool-caller", "version": "1.0"},
        {"id": "agent-single", "version": "1.0"},
    ],
    "connections": [
        {"from": "context-window", "to": "agent-single"},
        {"from": "model-openai", "to": "agent-single"},
        {"from": "tool-caller", "to": "agent-single"},
    ],
    "parameters": {
        "model-openai": {"model": "gpt-4o-mini", "temperature": 0.0},
        "tool-caller": {
            "tools": [
                {
                    "name": "add",
                    "description": "sum of two numbers",
                    "func": "lambda a, b: a + b",
                }
            ]
        },
        "agent-single": {"max_iterations": 3},
    },
}


class _FakeOpenAI:
    def __init__(self, **kwargs):
        self._calls = 0
        self.replies = MODEL_REPLIES

    @property
    def chat(self):
        return SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        reply = self.replies[min(self._calls, len(self.replies) - 1)]
        self._calls += 1
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=reply))],
            usage=None,
        )


@pytest.fixture(autouse=True)
def clean_registry():
    reset()
    yield
    reset()


def _new_runtime(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    return RuntimeUI(model_client=_FakeOpenAI)


# --- AC1+AC2: 真实 demo 回复 + 真实遥测流（进程内 runtime） ---


def test_runtime_generates_demo_and_chats_with_real_pipeline(monkeypatch):
    runtime = _new_runtime(monkeypatch)
    try:
        generated = runtime.generate_demo("demo-1", CALCULATOR_RECIPE)
        assert generated["status"] == "done"
        assert generated["demoId"] == "demo-1"

        chat = runtime.send_chat(
            "demo-1", [{"role": "user", "content": "what is 2 + 3?"}]
        )
        assert chat["reply"]["role"] == "assistant"
        assert chat["reply"]["content"] == "the answer is 5"

        telemetry = runtime.get_telemetry("demo-1")
        components = {span["componentId"] for span in telemetry["spans"]}
        assert {"agent-single", "model-openai", "tool-caller"} <= components
        assert telemetry["spans"][0]["status"] == "ok"
    finally:
        runtime.close()


def test_runtime_telemetry_accumulates_across_chat_turns(monkeypatch):
    runtime = _new_runtime(monkeypatch)
    try:
        runtime.generate_demo("demo-1", CALCULATOR_RECIPE)
        first = runtime.get_telemetry("demo-1")
        runtime.send_chat("demo-1", [{"role": "user", "content": "what is 2 + 3?"}])
        second = runtime.get_telemetry("demo-1")
        assert len(second["spans"]) > len(first["spans"])
    finally:
        runtime.close()


# --- AC3: 真实消融 runner 跑出对比结果 ---


def test_runtime_ablation_runs_real_runner(monkeypatch):
    runtime = _new_runtime(monkeypatch)
    try:
        runtime.generate_demo("demo-1", CALCULATOR_RECIPE)
        res = runtime.trigger_ablation(
            "demo-1",
            {
                "variant": {
                    "kind": "override",
                    "target": "model-openai.temperature=0.9",
                    "description": "覆盖温度",
                }
            },
        )

        run = res["run"]
        assert run["status"] == "done"
        assert len(run["results"]) == 1
        result = run["results"][0]
        assert result["variant"]["target"] == "model-openai.temperature=0.9"
        assert result["scores"]["score"] == 1.0
        assert len(result["spans"]) > 0
    finally:
        runtime.close()


def test_runtime_ablation_rejects_unknown_component(monkeypatch):
    runtime = _new_runtime(monkeypatch)
    try:
        runtime.generate_demo("demo-1", CALCULATOR_RECIPE)
        with pytest.raises(ValueError):
            runtime.trigger_ablation(
                "demo-1",
                {"variant": {"kind": "remove", "target": "ghost"}},
            )
    finally:
        runtime.close()


# --- 离线兜底：无 OPENAI_API_KEY 时注入内置离线模型，仍走真实 demo 管线 ---


def test_runtime_falls_back_to_offline_model_without_api_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    runtime = RuntimeUI()
    try:
        runtime.generate_demo("demo-1", CALCULATOR_RECIPE)
        chat = runtime.send_chat("demo-1", [{"role": "user", "content": "你好"}])
        assert chat["reply"]["content"].startswith("离线回复：")
        assert len(runtime.get_telemetry("demo-1")["spans"]) > 0
    finally:
        runtime.close()


def test_runtime_falls_back_when_api_key_is_blank(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "")
    runtime = RuntimeUI()
    try:
        runtime.generate_demo("demo-1", CALCULATOR_RECIPE)
        chat = runtime.send_chat("demo-1", [{"role": "user", "content": "你好"}])
        assert chat["reply"]["content"].startswith("离线回复：")
    finally:
        runtime.close()


# --- HTTP 层：四个端点按 demo-api 契约返回 JSON ---


def _request(method, url, payload=None):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


@pytest.fixture()
def http_server(monkeypatch):
    runtime = _new_runtime(monkeypatch)
    server = build_app(runtime, host="127.0.0.1", port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        yield base
    finally:
        server.shutdown()
        server.server_close()
        runtime.close()


def test_http_generate_chat_telemetry_ablation_end_to_end(http_server):
    generated = _request(
        "POST", f"{http_server}/demo/demo-1/generate", {"recipe": CALCULATOR_RECIPE}
    )
    assert generated["status"] == "done"

    chat = _request(
        "POST",
        f"{http_server}/demo/demo-1/chat",
        {"messages": [{"role": "user", "content": "what is 2 + 3?"}]},
    )
    assert chat["reply"]["content"] == "the answer is 5"

    telemetry = _request("GET", f"{http_server}/demo/demo-1/telemetry")
    assert telemetry["spans"]
    assert telemetry["spans"][0]["componentId"]

    ablation = _request(
        "POST",
        f"{http_server}/demo/demo-1/ablations",
        {
            "variant": {
                "kind": "override",
                "target": "model-openai.temperature=0.9",
                "description": "覆盖温度",
            }
        },
    )
    assert ablation["run"]["status"] == "done"
    assert len(ablation["run"]["results"]) == 1


def test_http_chat_to_unknown_demo_returns_404(http_server):
    with pytest.raises(urllib.error.HTTPError) as exc_info:
        _request(
            "POST",
            f"{http_server}/demo/nope/chat",
            {"messages": [{"role": "user", "content": "hi"}]},
        )
    assert exc_info.value.code == 404
