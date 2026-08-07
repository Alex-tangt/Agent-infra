import json
from types import SimpleNamespace

import pytest

from components import as_dict, get_component, reset
from components.agent import Agent, ToolRequest, default_turn_strategy, register_agent
from components.context import ContextWindow
from components.model import OpenAIModel
from components.tools import Tool, ToolCallResult, ToolCaller
from recipe import validate


@pytest.fixture(autouse=True)
def clean_registry():
    reset()
    yield
    reset()


class FakeModel:
    def __init__(self, replies):
        self._replies = list(replies)
        self.calls = 0
        self.messages_seen = []

    def generate(self, messages):
        self.messages_seen.append(list(messages))
        index = min(self.calls, len(self._replies) - 1)
        self.calls += 1
        return self._replies[index]


class FakeClient:
    def __init__(self, reply="hello"):
        self.reply = reply
        self.calls = []

    @property
    def chat(self):
        return SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=self.reply))],
            usage=None,
        )

    @property
    def last_call(self):
        return self.calls[-1]


class _MinimalModel:
    def generate(self, messages):
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
    def call(self, request):
        return ToolCallResult(
            tool_name=request.tool_name,
            success=True,
            output="ok",
            tool_call_id="c",
        )


def make_add_tool():
    return Tool(name="add", func=lambda a, b: a + b)


def test_agent_component_registers_contract():
    register_agent()

    spec = get_component("agent-single", "1.0")

    assert spec.id == "agent-single"
    assert spec.version == "1.0"
    assert [p.name for p in spec.inputs] == ["user_message"]
    assert spec.inputs[0].type == "string"
    assert [p.name for p in spec.outputs] == ["reply"]
    assert spec.outputs[0].type == "string"
    assert spec.params["max_iterations"].default == 5
    assert spec.params["max_iterations"].min == 1


def test_agent_contract_is_consumed_by_recipe_validation():
    register_agent()

    result = validate(
        {
            "components": [{"id": "agent-single", "version": "1.0"}],
            "connections": [],
            "parameters": {"agent-single": {"max_iterations": 3}},
        },
        registry=as_dict(),
    )

    assert result.components[0]["id"] == "agent-single"
    assert result.parameters["agent-single"]["max_iterations"] == 3


def test_agent_injects_real_parts_from_outside():
    client = FakeClient(reply="it is sunny")
    model = OpenAIModel(client=client)
    context = ContextWindow()
    tools = ToolCaller(tools=[])

    agent = Agent(model=model, context=context, tools=tools)
    reply = agent.run("weather?")

    assert reply == "it is sunny"
    assert client.last_call["messages"][0] == {"role": "user", "content": "weather?"}


def test_agent_accepts_any_parts_that_satisfy_duck_typed_interface():
    agent = Agent(
        model=_MinimalModel(),
        context=_MinimalContext(),
        tools=_MinimalTools(),
    )

    assert agent.run("hi") == "final"


def test_returns_final_reply_when_model_does_not_request_tool():
    model = FakeModel(["it is sunny"])
    context = ContextWindow()
    tools = ToolCaller(tools=[])
    agent = Agent(model=model, context=context, tools=tools)

    reply = agent.run("weather?")

    assert reply == "it is sunny"
    assert model.calls == 1
    assert [m["role"] for m in context.get_messages()] == ["user", "assistant"]


def test_runs_full_loop_llm_tool_llm_and_returns_summary():
    model = FakeModel(
        [
            json.dumps({"tool": "add", "arguments": {"a": 2, "b": 3}}),
            "the answer is 5",
        ]
    )
    context = ContextWindow()
    tools = ToolCaller(tools=[make_add_tool()])
    agent = Agent(model=model, context=context, tools=tools)

    reply = agent.run("what is 2 + 3?")

    assert reply == "the answer is 5"
    assert model.calls == 2
    messages = context.get_messages()
    assert [m["role"] for m in messages] == ["user", "assistant", "tool", "assistant"]
    assert messages[2]["content"] == "5"
    assert messages[2]["tool_call_id"]


def test_tool_result_is_fed_back_to_model_in_second_turn():
    model = FakeModel(
        [
            json.dumps({"tool": "add", "arguments": {"a": 2, "b": 3}}),
            "the answer is 5",
        ]
    )
    agent = Agent(
        model=model,
        context=ContextWindow(),
        tools=ToolCaller(tools=[make_add_tool()]),
    )

    agent.run("what is 2 + 3?")

    assert model.messages_seen[1][-1]["role"] == "tool"
    assert model.messages_seen[1][-1]["content"] == "5"


def test_stops_after_max_iterations_when_model_keeps_requesting_tools():
    tool_request = json.dumps({"tool": "add", "arguments": {"a": 1, "b": 1}})
    model = FakeModel([tool_request])
    agent = Agent(
        model=model,
        context=ContextWindow(),
        tools=ToolCaller(tools=[make_add_tool()]),
        max_iterations=3,
    )

    reply = agent.run("keep going")

    assert model.calls == 3
    assert reply == tool_request


def test_default_turn_strategy_returns_none_for_plain_text():
    assert default_turn_strategy("the answer is 5") is None


def test_default_turn_strategy_extracts_tool_request_from_json_text():
    request = default_turn_strategy('{"tool": "add", "arguments": {"a": 2, "b": 3}}')

    assert isinstance(request, ToolRequest)
    assert request.tool_name == "add"
    assert request.arguments == {"a": 2, "b": 3}


def test_custom_turn_strategy_is_used_for_tool_request_detection():
    def strategy(text):
        if text.startswith("USE_TOOL"):
            return ToolRequest(tool_name="add", arguments={"a": 1, "b": 2})
        return None

    model = FakeModel(["USE_TOOL add", "done"])
    agent = Agent(
        model=model,
        context=ContextWindow(),
        tools=ToolCaller(tools=[make_add_tool()]),
        turn_strategy=strategy,
    )

    reply = agent.run("go")

    assert reply == "done"
    assert model.calls == 2


def test_agent_rejects_invalid_max_iterations():
    with pytest.raises(ValueError, match="max_iterations"):
        Agent(
            model=_MinimalModel(),
            context=_MinimalContext(),
            tools=_MinimalTools(),
            max_iterations=0,
        )
