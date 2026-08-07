from types import SimpleNamespace

import pytest

from components import as_dict, get_component, reset
from components.model import OpenAIModel, TokenUsage, register_component
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


class FakeClient:
    def __init__(self, reply="hello", prompt=0, completion=0):
        self.reply = reply
        self.prompt = prompt
        self.completion = completion
        self.calls = []

    @property
    def chat(self):
        return SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return make_response(self.reply, self.prompt, self.completion)

    @property
    def last_call(self):
        return self.calls[-1]


def test_registered_contract_declares_message_input_and_reply_output():
    register_component()

    spec = get_component("model-openai", "1.0")

    assert spec.id == "model-openai"
    assert [p.name for p in spec.inputs] == ["messages"]
    assert [p.name for p in spec.outputs] == ["response"]


def test_registered_contract_declares_model_params_with_defaults():
    register_component()

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
    register_component()

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
