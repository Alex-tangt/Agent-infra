from types import SimpleNamespace

import pytest

from components import as_dict, get_component, reset
from components.model import (
    ModelReply,
    OllamaModel,
    OpenAIModel,
    TokenUsage,
    register_model,
    register_ollama_model,
)
from recipe import validate


@pytest.fixture(autouse=True)
def clean_registry():
    reset()
    yield
    reset()


def make_response(reply, prompt=0, completion=0):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=reply))],
        usage=SimpleNamespace(
            prompt_tokens=prompt,
            completion_tokens=completion,
            total_tokens=prompt + completion,
        ),
    )


def make_tool_call_response(calls, content=None, prompt=0, completion=0):
    """构造带原生 tool_calls 的响应；calls 为 [(call_id, name, arguments_json)]"""
    tool_calls = []
    for call_id, name, arguments in calls:
        tool_calls.append(
            SimpleNamespace(
                id=call_id,
                type="function",
                function=SimpleNamespace(name=name, arguments=arguments),
            )
        )
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content, tool_calls=tool_calls))],
        usage=SimpleNamespace(
            prompt_tokens=prompt,
            completion_tokens=completion,
            total_tokens=prompt + completion,
        ),
    )


class FakeClient:
    def __init__(self, reply="hello", prompt=0, completion=0, tool_calls=None):
        self.reply = reply
        self.prompt = prompt
        self.completion = completion
        self.tool_calls = tool_calls
        self.calls = []

    @property
    def chat(self):
        return SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.tool_calls is not None:
            return make_tool_call_response(
                self.tool_calls, prompt=self.prompt, completion=self.completion
            )
        return make_response(self.reply, self.prompt, self.completion)

    @property
    def last_call(self):
        return self.calls[-1]


def test_registered_contract_declares_message_input_and_reply_output():
    register_model()

    spec = get_component("model-openai", "1.0")

    assert spec.id == "model-openai"
    assert [p.name for p in spec.inputs] == ["messages"]
    assert [p.name for p in spec.outputs] == ["response"]


def test_registered_contract_declares_model_params_with_defaults():
    register_model()

    spec = get_component("model-openai", "1.0")

    model = spec.params["model"]
    assert model.type == "string"
    assert model.default == "gpt-4o-mini"
    assert "gpt-4o-mini" in model.enum

    temperature = spec.params["temperature"]
    assert temperature.type == "number"
    assert temperature.default == 0.7
    assert temperature.min == 0.0
    assert temperature.max == 2.0

    max_tokens = spec.params["max_tokens"]
    assert max_tokens.type == "number"
    assert max_tokens.default == 1024
    assert max_tokens.min == 1


def test_registered_contract_is_consumed_by_recipe_validation():
    register_model()

    result = validate(
        {
            "components": [{"id": "model-openai", "version": "1.0"}],
            "connections": [],
            "parameters": {"model-openai": {"temperature": 0.5}},
        },
        registry=as_dict(),
    )

    assert result.components[0]["id"] == "model-openai"
    assert result.parameters["model-openai"]["temperature"] == 0.5


def test_constructor_rejects_out_of_range_params():
    with pytest.raises(ValueError, match="model"):
        OpenAIModel(model="does-not-exist")
    with pytest.raises(ValueError, match="temperature"):
        OpenAIModel(temperature=2.5)
    with pytest.raises(ValueError, match="max_tokens"):
        OpenAIModel(max_tokens=0)


def test_generate_calls_model_and_returns_reply():
    client = FakeClient(reply="it is sunny")
    model = OpenAIModel(client=client)

    reply = model.generate([{"role": "user", "content": "weather?"}])

    assert reply == "it is sunny"
    assert client.last_call["messages"] == [{"role": "user", "content": "weather?"}]
    assert client.last_call["model"] == "gpt-4o-mini"
    assert client.last_call["temperature"] == 0.7
    assert client.last_call["max_tokens"] == 1024


def test_generate_reports_token_usage_via_on_usage_callback():
    client = FakeClient(reply="hello", prompt=9, completion=3)
    reported = []
    model = OpenAIModel(client=client, on_usage=lambda cid, usage: reported.append((cid, usage)))

    model.generate([{"role": "user", "content": "hi"}])

    assert reported == [("model-openai", TokenUsage(prompt_tokens=9, completion_tokens=3, total_tokens=12))]


def test_generate_works_without_on_usage_callback():
    client = FakeClient(reply="ok")
    model = OpenAIModel(client=client)

    assert model.generate([{"role": "user", "content": "hi"}]) == "ok"


def test_default_client_requires_openai_api_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    with pytest.raises(ValueError, match="OPENAI_API_KEY"):
        OpenAIModel()


# --- 子项 1：原生工具调用（tools schema 透传 + 结构化 tool_calls 返回） ---


def test_generate_passes_tools_schema_to_client():
    client = FakeClient(reply="ok")
    model = OpenAIModel(client=client)
    tools = [{"type": "function", "function": {"name": "add", "parameters": {}}}]

    model.generate([{"role": "user", "content": "hi"}], tools=tools)

    assert client.last_call["tools"] == tools


def test_generate_omits_tools_key_when_no_tools_given():
    client = FakeClient(reply="ok")
    model = OpenAIModel(client=client)

    model.generate([{"role": "user", "content": "hi"}])

    assert "tools" not in client.last_call


def test_generate_returns_model_reply_with_native_tool_calls():
    client = FakeClient(tool_calls=[("call_1", "add", '{"a": 2, "b": 3}')])
    model = OpenAIModel(client=client)

    reply = model.generate([{"role": "user", "content": "what is 2+3?"}])

    assert isinstance(reply, ModelReply)
    assert reply.content is None
    assert len(reply.tool_calls) == 1
    call = reply.tool_calls[0]
    assert call.id == "call_1"
    assert call.name == "add"
    assert call.arguments == {"a": 2, "b": 3}


def test_generate_returns_plain_string_when_no_tool_calls():
    client = FakeClient(reply="it is sunny")
    model = OpenAIModel(client=client)

    reply = model.generate([{"role": "user", "content": "weather?"}])

    assert reply == "it is sunny"


def test_generate_tolerates_malformed_tool_call_arguments():
    client = FakeClient(tool_calls=[("call_1", "add", "not-json")])
    model = OpenAIModel(client=client)

    reply = model.generate([{"role": "user", "content": "hi"}])

    assert reply.tool_calls[0].arguments == {}


def test_generate_reports_usage_for_tool_call_responses():
    client = FakeClient(tool_calls=[("call_1", "add", "{}")], prompt=9, completion=3)
    reported = []
    model = OpenAIModel(
        client=client, on_usage=lambda cid, usage: reported.append((cid, usage))
    )

    model.generate([{"role": "user", "content": "hi"}])

    assert reported == [("model-openai", TokenUsage(prompt_tokens=9, completion_tokens=3, total_tokens=12))]


# --- 子项 3：model-openai 契约元数据 ---


def test_openai_spec_has_description_and_role():
    register_model()

    spec = get_component("model-openai", "1.0")

    assert spec.role == "model"
    assert isinstance(spec.description, str) and spec.description


# --- 子项 4：model-ollama 组件 ---


def test_ollama_spec_registers_with_defaults():
    register_ollama_model()

    spec = get_component("model-ollama", "1.0")

    assert spec.id == "model-ollama"
    assert spec.version == "1.0"
    assert spec.role == "model"
    assert isinstance(spec.description, str) and spec.description
    assert [p.name for p in spec.inputs] == ["messages"]
    assert [p.name for p in spec.outputs] == ["response"]
    assert spec.params["model"].default == "llama3"
    assert spec.params["temperature"].default == 0.7
    assert spec.params["max_tokens"].default == 1024
    assert spec.params["base_url"].default == "http://localhost:11434/v1"


def test_ollama_model_uses_defaults_and_injected_client():
    client = FakeClient(reply="hi")
    model = OllamaModel(client=client)

    assert model.model == "llama3"
    assert model.base_url == "http://localhost:11434/v1"

    reply = model.generate([{"role": "user", "content": "hi"}])

    assert reply == "hi"
    assert client.last_call["model"] == "llama3"


def test_ollama_model_default_client_points_at_local_base_url(monkeypatch):
    import components.model.ollama as ollama_module

    captured = {}

    def fake_openai(**kwargs):
        captured.update(kwargs)
        return FakeClient(reply="hi")

    monkeypatch.setattr(ollama_module, "OpenAI", fake_openai)

    model = OllamaModel()

    assert captured["base_url"] == "http://localhost:11434/v1"
    assert model.generate([{"role": "user", "content": "hi"}]) == "hi"


def test_ollama_model_passes_tools_and_returns_native_tool_calls():
    client = FakeClient(tool_calls=[("call_1", "add", '{"a": 1, "b": 2}')])
    model = OllamaModel(client=client)
    tools = [{"type": "function", "function": {"name": "add", "parameters": {}}}]

    reply = model.generate([{"role": "user", "content": "hi"}], tools=tools)

    assert client.last_call["tools"] == tools
    assert isinstance(reply, ModelReply)
    assert reply.tool_calls[0].name == "add"
    assert reply.tool_calls[0].arguments == {"a": 1, "b": 2}


def test_ollama_model_reports_usage_with_its_component_id():
    client = FakeClient(reply="hi", prompt=4, completion=6)
    reported = []
    model = OllamaModel(
        client=client, on_usage=lambda cid, usage: reported.append((cid, usage))
    )

    model.generate([{"role": "user", "content": "hi"}])

    assert reported == [("model-ollama", TokenUsage(prompt_tokens=4, completion_tokens=6, total_tokens=10))]


def test_ollama_model_rejects_out_of_range_params():
    with pytest.raises(ValueError, match="temperature"):
        OllamaModel(temperature=3.0)
