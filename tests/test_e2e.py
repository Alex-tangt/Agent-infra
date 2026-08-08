import subprocess
import sys
import textwrap
from pathlib import Path
from types import SimpleNamespace

import pytest

import components.model as model_module
from components import as_dict, reset
from components.agent import register_agent
from components.context import register_context
from components.model import register_model
from components.tools import register_tool_caller
from wiring import generate

REPO_ROOT = Path(__file__).resolve().parent.parent

CALCULATOR_RECIPE = {
    "name": "calculator-agent",
    "components": [
        {"id": "context-window", "version": "1.0"},
        {"id": "model-openai", "version": "1.0"},
        {"id": "tool-caller", "version": "1.0"},
        {"id": "agent-single", "version": "1.0"},
    ],
    "connections": [
        {"from": "context-window", "to": "agent-single"},
        {"from": "model-openai", "to": "agent-single"},
        {"from": "tool-caller", "to": "agent-single"},
    ],
    "parameters": {
        "model-openai": {"model": "gpt-4o-mini", "temperature": 0.0},
        "tool-caller": {
            "tools": [
                {
                    "name": "add",
                    "description": "sum of two numbers",
                    "func": "lambda a, b: a + b",
                }
            ]
        },
        "agent-single": {"max_iterations": 3},
    },
}


@pytest.fixture(autouse=True)
def clean_registry():
    reset()
    yield
    reset()


def _registry():
    register_context()
    register_model()
    register_tool_caller()
    register_agent()
    return as_dict()


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


# --- AC1: 用一份真实配方（模型+上下文+工具+Agent）生成 demo ---


def test_real_recipe_generates_demo_glue():
    code = generate(CALCULATOR_RECIPE, registry=_registry())

    assert isinstance(code, str)
    assert "context_window = ContextWindow(" in code
    assert "model_openai = OpenAIModel(" in code
    assert "tool_caller = ToolCaller(" in code
    assert "agent_single = Agent(model=model_openai, context=context_window, tools=tool_caller" in code
    assert "register_agent()" in code


# --- AC2: 生成产物能独立运行（不依赖测试脚手架） + AC3: 跑完一次完整循环 ---


def test_generated_artifact_runs_full_tool_loop_in_process(monkeypatch, tmp_path):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(model_module, "OpenAI", _FakeOpenAI)

    code = generate(CALCULATOR_RECIPE, registry=_registry())
    reset()
    demo = tmp_path / "calculator_agent.py"
    demo.write_text(code, encoding="utf-8")

    namespace = {"__name__": "calculator_agent"}
    exec(compile(demo.read_text(encoding="utf-8"), str(demo), "exec"), namespace)

    reply = namespace["run"]("what is 2 + 3?")

    assert reply == "the answer is 5"
    assert namespace["model_openai"]._client._calls == 2
    context = namespace["context_window"]
    messages = context.get_messages()
    assert [m["role"] for m in messages] == ["user", "assistant", "tool", "assistant"]
    assert messages[2]["content"] == "5"
    assert messages[2]["tool_call_id"]


def test_generated_artifact_runs_standalone_as_subprocess(tmp_path):
    code = generate(CALCULATOR_RECIPE, registry=_registry())
    reset()
    demo = tmp_path / "calculator_agent.py"
    demo.write_text(code, encoding="utf-8")

    prelude = textwrap.dedent(
        f"""
        import os
        from types import SimpleNamespace
        os.environ['OPENAI_API_KEY'] = 'test-key'
        import components.model as model_module
        class FakeOpenAI:
            def __init__(self, **kwargs):
                self._calls = 0
            @property
            def chat(self):
                return SimpleNamespace(completions=SimpleNamespace(create=self.create))
            def create(self, **kwargs):
                self._calls += 1
                if self._calls == 1:
                    message = SimpleNamespace(
                        content=None,
                        tool_calls=[
                            SimpleNamespace(
                                id='call_add_1',
                                type='function',
                                function=SimpleNamespace(
                                    name='add', arguments='{{"a": 2, "b": 3}}'
                                ),
                            )
                        ],
                    )
                else:
                    message = SimpleNamespace(content='the answer is 5', tool_calls=None)
                return SimpleNamespace(
                    choices=[SimpleNamespace(message=message)],
                    usage=None,
                )
        model_module.OpenAI = FakeOpenAI
        exec(open(r'{demo}', encoding='utf-8').read())
        print(run('what is 2 + 3?'))
        """
    )
    result = subprocess.run(
        [sys.executable, "-c", prelude],
        capture_output=True,
        text=True,
        cwd=str(REPO_ROOT),
        timeout=60,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "the answer is 5"


# --- AC4: 端到端测试作为常驻回归（配方→生成→运行→断言） ---


def test_e2e_generation_and_run_are_repeatable(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(model_module, "OpenAI", _FakeOpenAI)
    registry = _registry()

    first = generate(CALCULATOR_RECIPE, registry=registry)
    second = generate(CALCULATOR_RECIPE, registry=registry)
    assert first == second

    reset()
    demo = tmp_path / "calculator_agent.py"
    demo.write_text(first, encoding="utf-8")

    namespaces = []
    for _ in range(2):
        namespace = {"__name__": "calculator_agent"}
        exec(compile(demo.read_text(encoding="utf-8"), str(demo), "exec"), namespace)
        namespaces.append(namespace)
        reset()

    assert namespaces[0]["run"]("what is 2 + 3?") == "the answer is 5"
    assert namespaces[1]["run"]("what is 2 + 3?") == "the answer is 5"
