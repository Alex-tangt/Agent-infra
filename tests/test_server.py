import json
import threading
import urllib.error
import urllib.request
from types import SimpleNamespace

import pytest

from components import reset
from server.app import build_app
from server.config_store import ConfigStore
from server.runtime import RuntimeUI

REPO_ROOT = pytest.importorskip("pathlib").Path(__file__).resolve().parent.parent
DEMO_CODE = (REPO_ROOT / "demos" / "calculator_agent.py").read_text(encoding="utf-8")


class _FakeOpenAI:
    def __init__(self, **kwargs):
        self._calls = 0

    @property
    def chat(self):
        return SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        self._calls += 1
        if self._calls == 1:
            # 第一轮：原生 tool_calls 请求调用 add 工具
            message = SimpleNamespace(
                content=None,
                tool_calls=[
                    SimpleNamespace(
                        id="call_add_1",
                        type="function",
                        function=SimpleNamespace(
                            name="add", arguments='{"a": 2, "b": 3}'
                        ),
                    )
                ],
            )
        else:
            message = SimpleNamespace(content="the answer is 5", tool_calls=None)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=message)],
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


# --- AC1+AC2: 真实 demo 回复 + 真实遥测流（进程内 runtime，代码是唯一真相源） ---


def test_runtime_generates_demo_and_chats_with_real_pipeline(monkeypatch):
    runtime = _new_runtime(monkeypatch)
    try:
        generated = runtime.generate_demo_from_code("demo-1", DEMO_CODE)
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
        runtime.generate_demo_from_code("demo-1", DEMO_CODE)
        first = runtime.get_telemetry("demo-1")
        runtime.send_chat("demo-1", [{"role": "user", "content": "what is 2 + 3?"}])
        second = runtime.get_telemetry("demo-1")
        assert len(second["spans"]) > len(first["spans"])
    finally:
        runtime.close()


# --- AC3: 真实消融 runner 用运行时注入跑出变体对比（不依赖配方） ---


def test_runtime_ablation_override_runs_real_runner(monkeypatch):
    runtime = _new_runtime(monkeypatch)
    try:
        runtime.generate_demo_from_code("demo-1", DEMO_CODE)
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


def test_runtime_ablation_remove_drops_component_from_telemetry(monkeypatch):
    runtime = _new_runtime(monkeypatch)
    try:
        runtime.generate_demo_from_code("demo-1", DEMO_CODE)
        res = runtime.trigger_ablation(
            "demo-1",
            {"variant": {"kind": "remove", "target": "tool-caller"}},
        )

        result = res["run"]["results"][0]
        # 删除工具组件后变体不再产生 tool-caller 的遥测 span
        assert "tool-caller" not in {span["componentId"] for span in result["spans"]}
        assert result["scores"]["score"] == 1.0
    finally:
        runtime.close()


def test_runtime_ablation_swap_replaces_component(monkeypatch):
    runtime = _new_runtime(monkeypatch)
    try:
        runtime.generate_demo_from_code("demo-1", DEMO_CODE)
        res = runtime.trigger_ablation(
            "demo-1",
            {"variant": {"kind": "swap", "target": "model-openai->model-ollama"}},
        )

        result = res["run"]["results"][0]
        # 替换组件进入遥测（model-ollama），原组件不再产生 span
        component_ids = {span["componentId"] for span in result["spans"]}
        assert "model-ollama" in component_ids
        assert "model-openai" not in component_ids
        assert result["scores"]["score"] == 1.0
    finally:
        runtime.close()


def test_runtime_ablation_rejects_unknown_component(monkeypatch):
    runtime = _new_runtime(monkeypatch)
    try:
        runtime.generate_demo_from_code("demo-1", DEMO_CODE)
        with pytest.raises(ValueError):
            runtime.trigger_ablation(
                "demo-1",
                {"variant": {"kind": "remove", "target": "ghost"}},
            )
    finally:
        runtime.close()


# --- AC4: ADR-0005 代码路径——运行时直接收 demo 代码（真相源） ---


def test_runtime_generate_from_code_rejects_invalid_param(monkeypatch):
    runtime = _new_runtime(monkeypatch)
    try:
        bad_code = DEMO_CODE.replace('model="gpt-4o-mini"', 'model="claude-3"')
        with pytest.raises(ValueError) as exc_info:
            runtime.generate_demo_from_code("demo-bad", bad_code)
        assert "must be one of" in str(exc_info.value)
        assert "第" in str(exc_info.value)
    finally:
        runtime.close()


def test_runtime_generate_from_code_rejects_invalid_python(monkeypatch):
    runtime = _new_runtime(monkeypatch)
    try:
        with pytest.raises(ValueError) as exc_info:
            runtime.generate_demo_from_code("demo-bad", "def run(:")
        assert "合法 Python" in str(exc_info.value)
    finally:
        runtime.close()


def test_runtime_generate_from_code_rejects_demo_without_agent(monkeypatch):
    runtime = _new_runtime(monkeypatch)
    try:
        with pytest.raises(ValueError) as exc_info:
            runtime.generate_demo_from_code(
                "demo-no-agent",
                "from components.model import OpenAIModel\n"
                "m = OpenAIModel(model='gpt-4o-mini')\n",
            )
        assert "role=agent" in str(exc_info.value)
    finally:
        runtime.close()


# --- 离线兜底：无 OPENAI_API_KEY 时注入内置离线模型，仍走真实 demo 管线 ---


def test_runtime_falls_back_to_offline_model_without_api_key(monkeypatch, tmp_path):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    runtime = RuntimeUI(config_store=ConfigStore(tmp_path / "config.json"))
    try:
        runtime.generate_demo_from_code("demo-1", DEMO_CODE)
        chat = runtime.send_chat("demo-1", [{"role": "user", "content": "你好"}])
        assert chat["reply"]["content"].startswith("离线回复：")
        assert len(runtime.get_telemetry("demo-1")["spans"]) > 0
    finally:
        runtime.close()


def test_runtime_falls_back_when_api_key_is_blank(monkeypatch, tmp_path):
    monkeypatch.setenv("OPENAI_API_KEY", "")
    runtime = RuntimeUI(config_store=ConfigStore(tmp_path / "config.json"))
    try:
        runtime.generate_demo_from_code("demo-1", DEMO_CODE)
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
        "POST", f"{http_server}/demo/demo-1/generate", {"code": DEMO_CODE}
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


def test_http_generate_from_code_invalid_returns_400(http_server):
    bad_code = DEMO_CODE.replace('model="gpt-4o-mini"', 'model="claude-3"')
    with pytest.raises(urllib.error.HTTPError) as exc_info:
        _request(
            "POST",
            f"{http_server}/demo/demo-bad/generate",
            {"code": bad_code},
        )
    assert exc_info.value.code == 400
    assert "must be one of" in exc_info.value.read().decode("utf-8")


def test_http_chat_to_unknown_demo_returns_404(http_server):
    with pytest.raises(urllib.error.HTTPError) as exc_info:
        _request(
            "POST",
            f"{http_server}/demo/nope/chat",
            {"messages": [{"role": "user", "content": "hi"}]},
        )
    assert exc_info.value.code == 404
