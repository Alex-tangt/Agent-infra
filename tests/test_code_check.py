import components.model as model_module
import pytest
from types import SimpleNamespace

from components import as_dict, reset
from components.agent import register_agent
from components.context import register_context
from components.model import register_model, register_ollama_model
from components.tools import register_tool_caller
from validation.code_check import check_demo_code

REPO_ROOT = pytest.importorskip("pathlib").Path(__file__).resolve().parent.parent
DEMO_PATH = REPO_ROOT / "demos" / "calculator_agent.py"


@pytest.fixture(autouse=True)
def clean_registry():
    reset()
    register_context()
    register_model()
    register_ollama_model()
    register_tool_caller()
    register_agent()
    yield
    reset()


def _registry():
    return as_dict()


# --- AC1: 合法 demo（demos/calculator_agent.py）通过全部构造调用校验 ---


def test_demo_passes_all_constructor_checks():
    code = DEMO_PATH.read_text(encoding="utf-8")
    result = check_demo_code(code, _registry())
    assert result.ok, [i.message for i in result.issues]
    assert result.checked_calls == 4  # ContextWindow / OpenAIModel / ToolCaller / Agent


# --- AC2: 参数契约校验（枚举 / 范围 / 未知参数）拦截 ---


def test_model_enum_validation_raises():
    code = (
        "from components.model import OpenAIModel\n"
        'm = OpenAIModel(model="claude-3")\n'
    )
    result = check_demo_code(code, _registry())
    assert not result.ok
    assert "must be one of" in result.issues[0].message


def test_model_range_validation_raises():
    code = (
        "from components.model import OpenAIModel\n"
        "m = OpenAIModel(temperature=3.5)\n"
    )
    result = check_demo_code(code, _registry())
    assert not result.ok
    assert "above max" in result.issues[0].message


def test_unknown_param_raises():
    code = (
        "from components.context import ContextWindow\n"
        "c = ContextWindow(max_rounds=5, bogus=1)\n"
    )
    result = check_demo_code(code, _registry())
    assert not result.ok
    assert "不在契约中" in result.issues[0].message


# --- AC3: 接口形态校验（位置参数 / 动态 kwargs / 零件注入非变量） ---


def test_positional_args_rejected():
    code = (
        "from components.context import ContextWindow\n"
        "c = ContextWindow(5)\n"
    )
    result = check_demo_code(code, _registry())
    assert not result.ok
    assert "位置参数" in result.issues[0].message


def test_agent_part_injection_must_be_variable():
    code = (
        "from components.agent import Agent\n"
        "from components.model import OpenAIModel\n"
        "m = OpenAIModel()\n"
        "a = Agent(model=(m if True else None), context=None, tools=None)\n"
    )
    result = check_demo_code(code, _registry())
    assert not result.ok
    assert "零件" in result.issues[0].message


# --- AC4: 合法变体放行（ollama 组件 / 带工具 agent） ---


def test_ollama_constructor_accepted():
    code = (
        "from components.model import OllamaModel\n"
        'm = OllamaModel(model="llama3", temperature=1.0, '
        'base_url="http://localhost:11434/v1")\n'
    )
    result = check_demo_code(code, _registry())
    assert result.ok


def test_agent_with_tools_accepted():
    code = (
        "from components.agent import Agent\n"
        "from components.context import ContextWindow\n"
        "from components.model import OpenAIModel\n"
        "from components.tools import Tool, ToolCaller\n"
        "c = ContextWindow()\n"
        "m = OpenAIModel()\n"
        'tc = ToolCaller(tools=[Tool(name="add")])\n'
        "a = Agent(model=m, context=c, tools=tc)\n"
    )
    result = check_demo_code(code, _registry())
    assert result.ok


# --- AC5: 语法错误报告 ---


def test_invalid_python_reports_syntax_error():
    result = check_demo_code("def run(:", _registry())
    assert not result.ok
    assert "合法 Python" in result.issues[0].message


# --- AC6: 极简闭环——校验通过的 demo 代码可 exec 并跑出回复 ---


def test_demo_code_runs_after_validation(monkeypatch):
    class StubModel:
        def __init__(self, **kwargs):
            pass

        def generate(self, messages, tools=None):
            return "stub answer"

    monkeypatch.setattr(model_module, "OpenAIModel", StubModel)

    code = DEMO_PATH.read_text(encoding="utf-8")
    result = check_demo_code(code, _registry())
    assert result.ok

    reset()
    namespace = {}
    exec(code, namespace)
    assert namespace["run"]("what is 2 + 3?") == "stub answer"
