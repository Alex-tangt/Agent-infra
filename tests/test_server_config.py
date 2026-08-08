"""issue #29 server 侧测试：运行环境配置持久化 / 掩码回显 / api key client 注入 / 组件清单。

- ConfigStore：持久化落盘、掩码回显、掩码占位不覆盖真实 key
- RuntimeUI：api key 走 client 注入（替代全局 monkey-patch）；离线兜底模型
- HTTP：GET/PUT /config、GET /components 按 demo-api 契约返回 JSON
"""

import json
import threading
import urllib.request
from pathlib import Path

import pytest
from openai import OpenAI

from components import reset
from server.app import build_app
from server.config_store import ConfigStore, mask_api_key
from server.runtime import RuntimeUI, _FallbackClient

REPO_ROOT = Path(__file__).resolve().parent.parent
DEMO_CODE = (REPO_ROOT / "demos" / "calculator_agent.py").read_text(encoding="utf-8")


@pytest.fixture(autouse=True)
def clean_registry():
    reset()
    yield
    reset()


def _store_with(tmp_path, payload: dict) -> ConfigStore:
    store = ConfigStore(tmp_path / "config.json")
    store.update(payload)
    return store


# --- ConfigStore：掩码 / 持久化 / 合并更新 ---


def test_mask_api_key_keeps_prefix_and_tail():
    assert mask_api_key("sk-proj-1234567890abcdef") == "sk-***def"
    assert mask_api_key("") == ""
    assert mask_api_key("short") == "***"


def test_config_store_persists_and_reloads(tmp_path):
    store = _store_with(
        tmp_path,
        {
            "apiKey": "sk-secret-123",
            "baseUrl": "https://api.example.com/v1",
            "componentParams": {"model-openai": {"model": "gpt-4o"}},
        },
    )
    assert store.path.is_file()

    reloaded = ConfigStore(store.path)
    assert reloaded.api_key == "sk-secret-123"
    assert reloaded.base_url == "https://api.example.com/v1"
    assert reloaded.component_params == {"model-openai": {"model": "gpt-4o"}}
    # 掩码回显：完整 key 不出现在任何对外视图里
    view = reloaded.view()
    assert view["apiKey"] == "sk-***123"
    assert "sk-secret-123" not in json.dumps(view)


def test_config_store_masked_key_does_not_overwrite_real_key(tmp_path):
    store = ConfigStore(tmp_path / "config.json")
    store.update({"apiKey": "sk-real-abc"})
    # 前端把 GET 到的掩码占位值原样回传 → 不覆盖真实 key
    store.update({"apiKey": "sk-***abc"})
    assert store.api_key == "sk-real-abc"
    # 显式清空（空字符串）→ 允许覆盖
    store.update({"apiKey": ""})
    assert store.api_key == ""


def test_config_store_merges_component_params_by_component(tmp_path):
    store = ConfigStore(tmp_path / "config.json")
    store.update(
        {
            "componentParams": {
                "model-openai": {"model": "gpt-4o-mini", "temperature": 0.7},
                "agent-single": {"max_iterations": 5},
            }
        }
    )
    # 只更新一个组件时，其他组件的默认参数保留
    store.update({"componentParams": {"model-openai": {"temperature": 0.2}}})
    assert store.component_params == {
        "model-openai": {"temperature": 0.2},
        "agent-single": {"max_iterations": 5},
    }


# --- RuntimeUI：api key 走 client 注入（不再全局 monkey-patch） ---


def _runtime(tmp_path, monkeypatch, payload: dict) -> RuntimeUI:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    return RuntimeUI(config_store=_store_with(tmp_path, payload))


def test_config_api_key_injects_real_openai_client(tmp_path, monkeypatch):
    runtime = _runtime(tmp_path, monkeypatch, {"apiKey": "sk-cfg-123"})
    try:
        assert isinstance(runtime._model_client, OpenAI)
        assert runtime._model_client.api_key == "sk-cfg-123"
    finally:
        runtime.close()


def test_env_api_key_used_when_no_config_key(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-env-123")
    runtime = RuntimeUI(config_store=ConfigStore(tmp_path / "config.json"))
    try:
        assert isinstance(runtime._model_client, OpenAI)
        assert runtime._model_client.api_key == "sk-env-123"
    finally:
        runtime.close()


def test_no_api_key_injects_offline_fallback(tmp_path, monkeypatch):
    runtime = _runtime(tmp_path, monkeypatch, {})
    try:
        assert isinstance(runtime._model_client, _FallbackClient)
        runtime.generate_demo_from_code("demo-1", DEMO_CODE)
        chat = runtime.send_chat("demo-1", [{"role": "user", "content": "你好"}])
        assert chat["reply"]["content"].startswith("离线回复：")
    finally:
        runtime.close()


def test_persisted_component_params_no_longer_auto_apply(tmp_path, monkeypatch):
    # ADR-0005：配方废除后 componentParams 不再回退进 demo 代码，
    # demo 代码里的字面参数保持原样（gpt-4o-mini 而非配置里的 gpt-4o）。
    runtime = _runtime(
        tmp_path,
        monkeypatch,
        {"componentParams": {"model-openai": {"model": "gpt-4o"}}},
    )
    try:
        runtime.generate_demo_from_code("demo-1", DEMO_CODE)
        instance = runtime._demos["demo-1"].interceptor._agent._model
        assert instance.model == "gpt-4o-mini"
    finally:
        runtime.close()


# --- HTTP 层：GET/PUT /config 与 GET /components ---


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
def http_server(tmp_path, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    runtime = RuntimeUI(config_store=ConfigStore(tmp_path / "config.json"))
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


def test_http_get_config_returns_masked_view(http_server):
    config = _request("GET", f"{http_server}/config")
    assert config["apiKey"] == ""
    assert config["baseUrl"] == ""
    assert config["componentParams"] == {}


def test_http_put_config_persists_and_masks(http_server, tmp_path):
    saved = _request(
        "PUT",
        f"{http_server}/config",
        {
            "apiKey": "sk-put-abc123",
            "baseUrl": "https://api.example.com/v1",
            "componentParams": {"model-openai": {"model": "gpt-4o"}},
        },
    )
    assert saved["apiKey"] == "sk-***123"
    assert saved["baseUrl"] == "https://api.example.com/v1"
    assert saved["componentParams"] == {"model-openai": {"model": "gpt-4o"}}
    # 完整 key 不落前端（响应），只落 server 侧持久化文件
    assert "sk-put-abc123" not in json.dumps(saved)
    assert "sk-put-abc123" in (tmp_path / "config.json").read_text(encoding="utf-8")

    again = _request("GET", f"{http_server}/config")
    assert again["apiKey"] == "sk-***123"


def test_http_put_masked_key_keeps_real_key(http_server, tmp_path):
    _request("PUT", f"{http_server}/config", {"apiKey": "sk-real-xyz"})
    _request("PUT", f"{http_server}/config", {"apiKey": "sk-***xyz"})
    # 持久化文件里的真实 key 未被掩码占位覆盖
    assert "sk-real-xyz" in (tmp_path / "config.json").read_text(encoding="utf-8")
    config = _request("GET", f"{http_server}/config")
    assert config["apiKey"] == "sk-***xyz"


def test_http_components_lists_registry_contracts(http_server):
    res = _request("GET", f"{http_server}/components")
    by_id = {c["id"]: c for c in res["components"]}
    assert set(by_id) == {
        "agent-single",
        "context-window",
        "model-openai",
        "model-ollama",
        "tool-caller",
    }
    ollama = by_id["model-ollama"]
    assert ollama["version"] == "1.0"
    assert ollama["role"] == "model"
    assert ollama["description"]
    assert ollama["params"]["model"]["default"] == "llama3"
    assert ollama["params"]["base_url"]["default"] == "http://localhost:11434/v1"
    model = by_id["model-openai"]
    assert model["version"] == "1.0"
    assert model["role"] == "model"
    assert model["description"]
    assert model["inputs"] == [{"name": "messages", "type": "MessageList"}]
    assert model["outputs"] == [{"name": "response", "type": "string"}]
    assert model["params"]["model"]["type"] == "string"
    assert model["params"]["model"]["default"] == "gpt-4o-mini"
    assert model["params"]["temperature"]["type"] == "number"
    assert model["params"]["temperature"]["min"] == 0.0
    assert model["params"]["temperature"]["max"] == 2.0


def test_http_generate_with_code_runs_offline(http_server):
    # 无 api key + 持久化配置 → 收 demo 代码生成并离线跑通全链路
    generated = _request(
        "POST", f"{http_server}/demo/demo-1/generate", {"code": DEMO_CODE}
    )
    assert generated["status"] == "done"

    chat = _request(
        "POST",
        f"{http_server}/demo/demo-1/chat",
        {"messages": [{"role": "user", "content": "你好"}]},
    )
    assert chat["reply"]["content"].startswith("离线回复：")
