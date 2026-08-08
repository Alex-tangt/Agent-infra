"""组件注入协议（ADR-0005 第 7 条）：set_param / replace_part / disable_part。

统一约定：每个组件实现 set_param(name, value)，agent 额外实现
replace_part(role, instance) 与 disable_part(role)；不支持的参数抛 ValueError。
"""

import pytest
from types import SimpleNamespace

from components import reset
from components.agent import Agent, register_agent
from components.context import ContextWindow, register_context
from components.model import ModelReply, OpenAIModel, ToolCall, register_model
from components.tools import Tool, ToolCaller, register_tool_caller


class _FakeClient:
    def __init__(self, reply="hello"):
        self.reply = reply

    @property
    def chat(self):
        class _Chat:
            def __init__(self, parent):
                self.parent = parent

            @property
            def completions(self):
                class _Completions:
                    def __init__(self, parent):
                        self.parent = parent

                    def create(self, **kwargs):
                        return SimpleNamespace(
                            choices=[
                                SimpleNamespace(
                                    message=SimpleNamespace(content=self.parent.reply)
                                )
                            ],
                            usage=None,
                        )

                return _Completions(self.parent)

        return _Chat(self)


class FakeModel:
    def __init__(self, replies=None):
        self._replies = list(replies or ["it is sunny"])
        self.calls = 0

    def generate(self, messages, tools=None):
        self.calls += 1
        index = min(self.calls - 1, len(self._replies) - 1)
        return self._replies[index]


class _MinimalModel:
    def generate(self, messages, tools=None):
        return "final"


class _MinimalContext:
    def __init__(self):
        self.messages = []

    def add_user_message(self, content):
        self.messages.append({"role": "user", "content": content})

    def add_assistant_message(self, content):
        self.messages.append({"role": "assistant", "content": content})

    def get_messages(self):
        return self.messages


class _MinimalTools:
    def available_tools(self):
        return []

    def call(self, request):
        from components.tools import ToolCallResult

        return ToolCallResult(
            tool_name=request.tool_name, success=True, output="ok", tool_call_id="c"
        )


def make_add_tool():
    return Tool(name="add", func=lambda a, b: a + b)


@pytest.fixture(autouse=True)
def clean_registry():
    reset()
    yield
    reset()


def _agent(**kwargs):
    return Agent(
        model=_MinimalModel(),
        context=_MinimalContext(),
        tools=_MinimalTools(),
        **kwargs,
    )


# --- Agent.set_param ---


def test_agent_set_param_overrides_max_iterations():
    agent = _agent(max_iterations=2)

    agent.set_param("max_iterations", 4)

    assert agent._max_iterations == 4


def test_agent_set_param_rejects_invalid_value():
    agent = _agent()

    with pytest.raises(ValueError, match="max_iterations"):
        agent.set_param("max_iterations", 0)


def test_agent_set_param_rejects_unknown_param():
    agent = _agent()

    with pytest.raises(ValueError, match="max_iterations"):
        agent.set_param("temperature", 0.5)


# --- Agent.replace_part ---


def test_agent_replace_part_swaps_model():
    agent = _agent()
    new_model = FakeModel(["replaced reply"])

    agent.replace_part("model", new_model)

    assert agent._model is new_model
    assert agent.run("hi") == "replaced reply"


def test_agent_replace_part_rejects_unknown_role():
    agent = _agent()

    with pytest.raises(ValueError, match="model/context/tools"):
        agent.replace_part("memory", object())


# --- Agent.disable_part ---


def test_agent_disable_tools_drops_tool_calls():
    model = FakeModel(
        [
            ModelReply(
                content=None,
                tool_calls=[ToolCall(id="c1", name="add", arguments={"a": 1, "b": 1})],
            ),
            "the answer is 2",
        ]
    )
    agent = Agent(
        model=model,
        context=ContextWindow(),
        tools=ToolCaller(tools=[make_add_tool()]),
    )

    agent.disable_part("tools")

    # 模型仍能正常走循环，但工具零件被摘除后工具调用不可达
    reply = agent.run("sum")
    assert reply == "the answer is 2"


def test_agent_disable_part_rejects_unknown_role():
    agent = _agent()

    with pytest.raises(ValueError, match="model/context/tools"):
        agent.disable_part("memory")


def test_agent_disable_model_returns_empty_reply():
    agent = _agent()

    agent.disable_part("model")

    assert agent.run("hi") == ""


# --- OpenAIModel.set_param ---


def test_openai_set_param_updates_and_validates():
    model = OpenAIModel(model="gpt-4o-mini", temperature=0.7, client=_FakeClient())

    model.set_param("temperature", 0.1)
    model.set_param("model", "gpt-4o")
    model.set_param("max_tokens", 512)

    assert model.temperature == 0.1
    assert model.model == "gpt-4o"
    assert model.max_tokens == 512


def test_openai_set_param_rejects_out_of_range():
    model = OpenAIModel(client=_FakeClient())

    with pytest.raises(ValueError, match="above max"):
        model.set_param("temperature", 3.5)


def test_openai_set_param_rejects_unknown_param():
    model = OpenAIModel(client=_FakeClient())

    with pytest.raises(ValueError, match="model-openai"):
        model.set_param("base_url", "http://localhost")


# --- OllamaModel.set_param ---


def test_ollama_set_param_supports_base_url():
    from components.model import OllamaModel

    model = OllamaModel(client=_FakeClient())

    model.set_param("base_url", "http://127.0.0.1:8080/v1")
    model.set_param("temperature", 0.0)

    assert model.base_url == "http://127.0.0.1:8080/v1"
    assert model.temperature == 0.0


def test_ollama_set_param_rejects_unknown_param():
    from components.model import OllamaModel

    model = OllamaModel(client=_FakeClient())

    with pytest.raises(ValueError, match="model-ollama"):
        model.set_param("tools", [])


# --- ContextWindow.set_param ---


def test_context_set_param_overrides_rounds_strategy_and_system_prompt():
    window = ContextWindow(max_rounds=5, strategy="truncate")

    window.set_param("max_rounds", 2)
    window.set_param("strategy", "truncate")
    window.set_param("system_prompt", "你是中文助手")

    assert window._max_rounds == 2
    assert window.get_messages() == [{"role": "system", "content": "你是中文助手"}]


def test_context_set_param_rejects_unsupported_strategy():
    window = ContextWindow()

    with pytest.raises(ValueError, match="strategy"):
        window.set_param("strategy", "summarize")


def test_context_set_param_rejects_unknown_param():
    window = ContextWindow()

    with pytest.raises(ValueError, match="context-window"):
        window.set_param("max_tokens", 10)


# --- ToolCaller.set_param ---


def test_tool_caller_set_param_swaps_strategy_and_tools():
    caller = ToolCaller(tools=[make_add_tool()], strategy="strict")

    caller.set_param("strategy", "lenient")
    assert caller.strategy == "lenient"

    caller.set_param("tools", [])
    assert caller.available_tools() == []


def test_tool_caller_set_param_rejects_invalid_strategy():
    caller = ToolCaller()

    with pytest.raises(ValueError, match="strategy"):
        caller.set_param("strategy", "magic")


def test_tool_caller_set_param_rejects_unknown_param():
    caller = ToolCaller()

    with pytest.raises(ValueError, match="tool-caller"):
        caller.set_param("max_iterations", 3)


# --- 协议面收敛：组件注册表契约仍在（注入协议不替代契约校验） ---


def test_registry_contracts_still_registered_after_register():
    register_context()
    register_model()
    from components.model import register_ollama_model

    register_ollama_model()
    register_tool_caller()
    register_agent()

    from components import as_dict

    assert sorted(spec.id for spec in as_dict().values()) == [
        "agent-single",
        "context-window",
        "model-ollama",
        "model-openai",
        "tool-caller",
    ]
