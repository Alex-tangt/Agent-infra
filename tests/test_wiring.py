import components.model as model_module
import pytest

from components import as_dict, reset
from components.context import register_context
from components.model import register_model
from components.tools import register_tool_caller
from wiring import generate
from wiring.engine import _ROLE_BY_COMPONENT


@pytest.fixture(autouse=True)
def clean_registry():
    reset()
    yield
    reset()


def _registry():
    register_context()
    register_model()
    register_tool_caller()
    return as_dict()


# --- AC1: 按配方查注册表，未知组件 id 当场报错 ---


def test_unknown_component_id_raises():
    recipe = {
        "components": [{"id": "ghost-component", "version": "1.0"}],
        "connections": [],
        "parameters": {},
    }

    with pytest.raises(ValueError, match="unknown component"):
        generate(recipe, registry=_registry())


def test_unknown_component_version_raises():
    recipe = {
        "components": [{"id": "model-openai", "version": "9.9"}],
        "connections": [],
        "parameters": {},
    }

    with pytest.raises(ValueError, match="unknown component"):
        generate(recipe, registry=_registry())


# --- AC2: 校验连线契约匹配，不匹配当场报错 ---


def test_connection_contract_mismatch_raises():
    recipe = {
        "components": [
            {"id": "context-window", "version": "1.0"},
            {"id": "tool-caller", "version": "1.0"},
        ],
        "connections": [{"from": "context-window", "to": "tool-caller"}],
        "parameters": {},
    }

    with pytest.raises(ValueError, match="do not match"):
        generate(recipe, registry=_registry())


def test_connection_matching_port_types_is_accepted():
    recipe = {
        "components": [
            {"id": "context-window", "version": "1.0"},
            {"id": "model-openai", "version": "1.0"},
        ],
        "connections": [{"from": "context-window", "to": "model-openai"}],
        "parameters": {},
    }

    code = generate(recipe, registry=_registry())

    assert isinstance(code, str)
    assert "context_window" in code


# --- AC3: 校验参数合法性（含枚举/范围），非法当场报错 ---


def test_parameter_outside_range_raises():
    recipe = {
        "components": [{"id": "model-openai", "version": "1.0"}],
        "connections": [],
        "parameters": {"model-openai": {"temperature": 3.5}},
    }

    with pytest.raises(ValueError, match="above max"):
        generate(recipe, registry=_registry())


def test_parameter_outside_enum_raises():
    recipe = {
        "components": [{"id": "model-openai", "version": "1.0"}],
        "connections": [],
        "parameters": {"model-openai": {"model": "claude-3"}},
    }

    with pytest.raises(ValueError, match="must be one of"):
        generate(recipe, registry=_registry())


# --- AC4: 按模板生成胶水代码，产物是可运行的普通代码 ---


def test_generated_glue_runs_single_agent_chain():
    class StubModel:
        def __init__(self, **kwargs):
            pass

        def generate(self, messages):
            return "stub answer"

    model_module.OpenAIModel = StubModel

    recipe = {
        "name": "weather-agent",
        "components": [
            {"id": "context-window", "version": "1.0"},
            {"id": "model-openai", "version": "1.0"},
        ],
        "connections": [{"from": "context-window", "to": "model-openai"}],
        "parameters": {"model-openai": {"temperature": 0.5}},
    }

    code = generate(recipe, registry=_registry())
    reset()
    namespace = {}
    exec(code, namespace)

    assert "register_context()" in code
    assert "register_model()" in code
    assert namespace["run"]("hello") == "stub answer"


def test_generated_glue_runs_context_only_without_external_calls():
    recipe = {
        "components": [{"id": "context-window", "version": "1.0"}],
        "connections": [],
        "parameters": {"context-window": {"max_rounds": 3}},
    }

    code = generate(recipe, registry=_registry())
    reset()
    namespace = {}
    exec(code, namespace)

    assert namespace["run"]("hi there") == [
        {"role": "user", "content": "hi there"}
    ]


def test_recipe_params_fill_construction_with_defaults_merged():
    recipe = {
        "components": [
            {"id": "context-window", "version": "1.0"},
            {"id": "model-openai", "version": "1.0"},
        ],
        "connections": [{"from": "context-window", "to": "model-openai"}],
        "parameters": {"model-openai": {"model": "gpt-4o", "temperature": 0.5}},
    }

    code = generate(recipe, registry=_registry())

    assert "context_window = ContextWindow(max_rounds=5, strategy='truncate')" in code
    assert "model_openai = OpenAIModel(model='gpt-4o', temperature=0.5, max_tokens=1024)" in code


# --- AC5: 同一配方多次生成，产物一致（可复现） ---


def test_generation_is_byte_identical_for_same_recipe():
    recipe = {
        "components": [
            {"id": "context-window", "version": "1.0"},
            {"id": "model-openai", "version": "1.0"},
        ],
        "connections": [{"from": "context-window", "to": "model-openai"}],
        "parameters": {"model-openai": {"temperature": 0.5}},
    }
    registry = _registry()

    first = generate(recipe, registry=registry)
    second = generate(recipe, registry=registry)

    assert first == second


# --- 确定性兜底：循环连线无法串成串行调用链，当场报错 ---


def test_cyclic_connection_raises():
    recipe = {
        "components": [
            {"id": "context-window", "version": "1.0"},
            {"id": "model-openai", "version": "1.0"},
        ],
        "connections": [
            {"from": "context-window", "to": "model-openai"},
            {"from": "model-openai", "to": "context-window"},
        ],
        "parameters": {},
    }

    with pytest.raises(ValueError, match="cycle"):
        generate(recipe, registry=_registry())


def test_recipe_object_path_also_validates_parameters():
    from recipe import Recipe

    recipe = Recipe(
        components=[{"id": "model-openai", "version": "1.0"}],
        connections=[],
        parameters={"model-openai": {"temperature": 99.0}},
    )

    with pytest.raises(ValueError, match="above max"):
        generate(recipe, registry=_registry())


def test_unconnected_component_without_string_input_raises():
    recipe = {
        "components": [
            {"id": "tool-caller", "version": "1.0"},
        ],
        "connections": [],
        "parameters": {},
    }

    with pytest.raises(ValueError, match="no incoming connection"):
        generate(recipe, registry=_registry())


# --- 子项 4：model-ollama 通过角色表接入 agent（仅加一行，不做契约驱动改造） ---


def test_model_ollama_role_is_known_to_wiring_engine():
    assert _ROLE_BY_COMPONENT["model-ollama"] == "model"


def test_agent_recipe_accepts_model_ollama_as_model_part():
    import wiring.engine as engine_module

    recipe = {
        "components": [
            {"id": "context-window", "version": "1.0"},
            {"id": "model-ollama", "version": "1.0"},
            {"id": "tool-caller", "version": "1.0"},
            {"id": "agent-single", "version": "1.0"},
        ],
        "connections": [
            {"from": "context-window", "to": "agent-single"},
            {"from": "model-ollama", "to": "agent-single"},
            {"from": "tool-caller", "to": "agent-single"},
        ],
        "parameters": {},
    }

    assert engine_module._agent_parts("agent-single", recipe["connections"])["model"] == "model-ollama"
