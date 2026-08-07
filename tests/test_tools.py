import pytest

from components import as_dict, get_component, reset
from components.tools import Tool, ToolCallRequest, ToolCallResult, ToolCaller, register_tool_caller
from recipe import validate


@pytest.fixture(autouse=True)
def clean_registry():
    reset()
    yield
    reset()


def make_add_tool():
    return Tool(
        name="add",
        description="add two numbers",
        parameters={"a": "number", "b": "number"},
        func=lambda a, b: a + b,
    )


def test_tool_caller_registers_contract():
    register_tool_caller()

    spec = get_component("tool-caller", "1.0")

    assert spec.id == "tool-caller"
    assert spec.version == "1.0"
    assert [p.name for p in spec.inputs] == ["tool_call"]
    assert spec.inputs[0].type == "ToolCallRequest"
    assert [p.name for p in spec.outputs] == ["result"]
    assert spec.outputs[0].type == "ToolCallResult"


def test_tool_caller_params_have_defaults_and_constraints():
    register_tool_caller()

    spec = get_component("tool-caller", "1.0")

    tools = spec.params["tools"]
    assert tools.type == "list"
    assert tools.default == []

    strategy = spec.params["strategy"]
    assert strategy.type == "string"
    assert strategy.default == "strict"
    assert strategy.enum == ["strict", "lenient"]


def test_recipe_rejects_unknown_strategy():
    register_tool_caller()
    recipe = {
        "components": [{"id": "tool-caller", "version": "1.0"}],
        "connections": [],
        "parameters": {"tool-caller": {"strategy": "magic"}},
    }

    with pytest.raises(ValueError, match="must be one of"):
        validate(recipe, registry=as_dict())


def test_recipe_accepts_valid_strategy():
    register_tool_caller()
    recipe = {
        "components": [{"id": "tool-caller", "version": "1.0"}],
        "connections": [],
        "parameters": {"tool-caller": {"strategy": "lenient"}},
    }

    result = validate(recipe, registry=as_dict())

    assert result.parameters["tool-caller"]["strategy"] == "lenient"


def test_caller_executes_declared_tool_and_returns_result():
    caller = ToolCaller(tools=[make_add_tool()])

    result = caller.call(ToolCallRequest(tool_name="add", arguments={"a": 2, "b": 3}))

    assert result.tool_name == "add"
    assert result.success is True
    assert result.output == 5


def test_strict_strategy_rejects_undeclared_tool():
    caller = ToolCaller(tools=[make_add_tool()], strategy="strict")

    with pytest.raises(ValueError, match="not declared"):
        caller.call(ToolCallRequest(tool_name="nope", arguments={}))


def test_lenient_strategy_returns_failed_result_for_undeclared_tool():
    caller = ToolCaller(tools=[make_add_tool()], strategy="lenient")

    result = caller.call(ToolCallRequest(tool_name="nope", arguments={}))

    assert result.tool_name == "nope"
    assert result.success is False
    assert "not declared" in result.error


def test_result_can_be_consumed_by_llm_as_message():
    caller = ToolCaller(tools=[make_add_tool()])

    result = caller.call(ToolCallRequest(tool_name="add", arguments={"a": 2, "b": 3}))

    message = result.to_message()
    assert message["role"] == "tool"
    assert message["tool"] == "add"
    assert message["content"] == "5"


def test_result_appends_back_into_conversation_flow():
    caller = ToolCaller(tools=[make_add_tool()])
    messages = [{"role": "user", "content": "what is 2 + 3?"}]

    messages.append(
        caller.call(ToolCallRequest(tool_name="add", arguments={"a": 2, "b": 3})).to_message()
    )

    assert [m["role"] for m in messages] == ["user", "tool"]
    assert messages[-1]["content"] == "5"


def test_caller_exposes_declared_tool_manifest():
    caller = ToolCaller(tools=[make_add_tool()])

    assert [tool.name for tool in caller.available_tools()] == ["add"]
