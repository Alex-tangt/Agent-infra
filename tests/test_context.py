import pytest

from components import ComponentSpec, as_dict, get_component, register, reset
from recipe import validate

from components.context import SPEC, ContextWindow, register_context


@pytest.fixture(autouse=True)
def clean_registry():
    reset()
    yield
    reset()


def test_context_component_registered_with_contract():
    register_context()

    spec = get_component("context-window", "1.0")

    assert spec.id == "context-window"
    assert spec.version == "1.0"
    assert [p.name for p in spec.inputs] == ["user_message"]
    assert spec.inputs[0].type == "string"
    assert [p.name for p in spec.outputs] == ["messages"]
    assert spec.outputs[0].type == "MessageList"


def test_contract_params_declare_defaults_and_bounds():
    register_context()

    spec = get_component("context-window", "1.0")

    assert spec.params["max_rounds"].default == 5
    assert spec.params["max_rounds"].min == 1
    assert spec.params["strategy"].default == "truncate"
    assert spec.params["strategy"].enum == ["truncate"]


def test_new_window_has_no_messages():
    assert ContextWindow().get_messages() == []


def test_output_message_list_is_consumable_by_model_component():
    window = ContextWindow()
    window.add_user_message("hi")
    window.add_assistant_message("hello")

    messages = window.get_messages()

    assert messages == [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "hello"},
    ]


def test_truncates_earliest_rounds_beyond_max_rounds():
    window = ContextWindow(max_rounds=2)
    for i in range(3):
        window.add_user_message(f"u{i}")
        window.add_assistant_message(f"a{i}")

    messages = window.get_messages()

    assert messages == [
        {"role": "user", "content": "u1"},
        {"role": "assistant", "content": "a1"},
        {"role": "user", "content": "u2"},
        {"role": "assistant", "content": "a2"},
    ]


def test_keeps_in_progress_user_message_after_truncation():
    window = ContextWindow(max_rounds=2)
    window.add_user_message("u0")
    window.add_assistant_message("a0")
    window.add_user_message("u1")
    window.add_assistant_message("a1")
    window.add_user_message("u2")

    messages = window.get_messages()

    assert messages == [
        {"role": "user", "content": "u1"},
        {"role": "assistant", "content": "a1"},
        {"role": "user", "content": "u2"},
    ]


def test_default_max_rounds_bounds_messages():
    window = ContextWindow()
    for i in range(6):
        window.add_user_message(f"u{i}")
        window.add_assistant_message(f"a{i}")

    messages = window.get_messages()

    assert [m["content"] for m in messages if m["role"] == "user"] == [
        f"u{i}" for i in range(1, 6)
    ]
    assert len(messages) == 10


def test_max_rounds_must_be_positive():
    with pytest.raises(ValueError, match="max_rounds"):
        ContextWindow(max_rounds=0)


def test_unsupported_strategy_is_rejected():
    with pytest.raises(ValueError, match="strategy"):
        ContextWindow(strategy="summarize")


def test_recipe_accepts_valid_context_params():
    register_context()
    recipe = {
        "components": [{"id": "context-window", "version": "1.0"}],
        "connections": [],
        "parameters": {"context-window": {"max_rounds": 3, "strategy": "truncate"}},
    }

    result = validate(recipe, registry=as_dict())

    assert result.parameters["context-window"]["max_rounds"] == 3
    assert result.parameters["context-window"]["strategy"] == "truncate"


def test_recipe_rejects_max_rounds_below_min():
    register_context()
    recipe = {
        "components": [{"id": "context-window", "version": "1.0"}],
        "connections": [],
        "parameters": {"context-window": {"max_rounds": 0}},
    }

    with pytest.raises(ValueError, match="below min"):
        validate(recipe, registry=as_dict())


def test_recipe_rejects_unsupported_strategy():
    register_context()
    recipe = {
        "components": [{"id": "context-window", "version": "1.0"}],
        "connections": [],
        "parameters": {"context-window": {"strategy": "summarize"}},
    }

    with pytest.raises(ValueError, match="must be one of"):
        validate(recipe, registry=as_dict())


def test_recipe_rejects_unknown_context_param():
    register_context()
    recipe = {
        "components": [{"id": "context-window", "version": "1.0"}],
        "connections": [],
        "parameters": {"context-window": {"fabricated_param": 1}},
    }

    with pytest.raises(ValueError, match="unknown parameter"):
        validate(recipe, registry=as_dict())
