import json
from types import SimpleNamespace

import pytest

import components.model as model_module
from components import as_dict, register, reset
from components.agent import register_agent
from components.context import register_context
from components.model import register_model
from components.tools import register_tool_caller
from components.types import ComponentSpec, ParamSpec, Port
from eval.ablation import (
    ComponentRemove,
    ComponentSwap,
    EvaluationResult,
    ParameterOverride,
    build_variants,
    comparison_table,
    run_ablation,
)
from telemetry.interceptor import TelemetryInterceptor
from wiring import generate

BASE_RECIPE = {
    "name": "calc-agent",
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

TOOL_REQUEST = json.dumps({"tool": "add", "arguments": {"a": 2, "b": 3}})
MODEL_REPLIES = [TOOL_REQUEST, "the answer is 5"]


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


def _registry_with_context_2():
    _registry()
    register(
        ComponentSpec(
            id="context-window",
            version="2.0",
            inputs=[Port(name="user_message", type="string")],
            outputs=[Port(name="messages", type="MessageList")],
            params={
                "max_rounds": ParamSpec(type="integer", min=1, default=10),
                "strategy": ParamSpec(
                    type="string", enum=["truncate", "drop"], default="drop"
                ),
            },
        )
    )
    return as_dict()


class _FakeOpenAI:
    def __init__(self, **kwargs):
        self._calls = 0
        self.replies = MODEL_REPLIES

    @property
    def chat(self):
        return SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        reply = self.replies[min(self._calls, len(self.replies) - 1)]
        self._calls += 1
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=reply))],
            usage=None,
        )


class FakeEvaluator:
    def __init__(self):
        self.calls = []

    def __call__(self, recipe, registry, case):
        self.calls.append((recipe, registry, case))
        return EvaluationResult(
            score=1.0,
            telemetry=[{"component_id": "model-openai", "duration_ms": 10.0}],
        )


# --- AC1: 定义消融变量——组件级（换/删）+ 参数级（覆盖参数） ---


def test_component_swap_variable_replaces_version():
    variant = ComponentSwap("model-openai", replacement_version="2.0").apply(BASE_RECIPE)

    model = next(c for c in variant["components"] if c["id"] == "model-openai")
    assert model["version"] == "2.0"
    assert len(variant["components"]) == len(BASE_RECIPE["components"])
    assert variant["connections"] == BASE_RECIPE["connections"]


def test_component_swap_variable_replaces_id_and_rewires_references():
    variant = ComponentSwap("context-window", replacement_id="memory-window").apply(
        BASE_RECIPE
    )

    ids = [c["id"] for c in variant["components"]]
    assert "context-window" not in ids
    assert "memory-window" in ids
    assert all(
        c["from"] != "context-window" and c["to"] != "context-window"
        for c in variant["connections"]
    )
    assert {"from": "memory-window", "to": "agent-single"} in variant["connections"]


def test_component_remove_variable_drops_component_connections_and_parameters():
    variant = ComponentRemove("tool-caller").apply(BASE_RECIPE)

    ids = [c["id"] for c in variant["components"]]
    assert "tool-caller" not in ids
    assert all(
        c["from"] != "tool-caller" and c["to"] != "tool-caller"
        for c in variant["connections"]
    )
    assert "tool-caller" not in variant["parameters"]


def test_parameter_override_variable_sets_parameter_only():
    variant = ParameterOverride("model-openai", "temperature", 0.7).apply(BASE_RECIPE)

    params = variant["parameters"]["model-openai"]
    assert params["temperature"] == 0.7
    assert params["model"] == "gpt-4o-mini"


@pytest.mark.parametrize(
    "variable",
    [
        ComponentRemove("ghost"),
        ComponentSwap("ghost", replacement_version="2.0"),
        ParameterOverride("ghost", "temperature", 0.5),
    ],
)
def test_variable_applying_to_unknown_component_raises(variable):
    with pytest.raises(ValueError, match="not found"):
        variable.apply(BASE_RECIPE)


# --- AC2: 基准配方 + 变量生成 N 个变体 ---


def test_build_variants_creates_one_variant_per_variable():
    variables = [
        ParameterOverride("model-openai", "temperature", 0.7),
        ComponentRemove("tool-caller"),
        ComponentSwap("context-window", replacement_version="2.0"),
    ]

    variants = build_variants(BASE_RECIPE, variables)

    assert len(variants) == 3
    assert [v.name for v in variants] == [
        "param:model-openai.temperature",
        "remove:tool-caller",
        "swap:context-window->context-window@2.0",
    ]


def test_build_variants_does_not_mutate_base_recipe():
    build_variants(BASE_RECIPE, [ComponentRemove("tool-caller")])

    ids = [c["id"] for c in BASE_RECIPE["components"]]
    assert "tool-caller" in ids


def test_each_variant_changes_only_its_own_axis():
    variable = ParameterOverride("model-openai", "temperature", 0.7)

    variant = build_variants(BASE_RECIPE, [variable])[0]

    assert variant.recipe["parameters"]["model-openai"]["temperature"] == 0.7
    assert (
        variant.recipe["parameters"]["agent-single"]
        == BASE_RECIPE["parameters"]["agent-single"]
    )
    assert variant.recipe["components"] == BASE_RECIPE["components"]


# --- AC3: 对每个变体跑同一评测集，收集得分 + 遥测 ---


def test_run_ablation_evaluates_every_case_for_every_variant_with_same_set():
    cases = [
        {"prompt": "what is 2 + 3?", "expected": "5"},
        {"prompt": "hi", "expected": "hi"},
    ]
    variables = [
        ParameterOverride("model-openai", "temperature", 0.7),
        ParameterOverride("model-openai", "temperature", 0.0),
    ]
    registry = _registry()
    evaluator = FakeEvaluator()

    run_ablation(BASE_RECIPE, variables, cases, evaluator, registry)

    assert len(evaluator.calls) == 4
    assert all(call[1] is registry for call in evaluator.calls)
    for index in range(2):
        seen = [call[2] for call in evaluator.calls[index * 2 : (index + 1) * 2]]
        assert seen == cases
    assert evaluator.calls[0][0]["parameters"]["model-openai"]["temperature"] == 0.7
    assert evaluator.calls[2][0]["parameters"]["model-openai"]["temperature"] == 0.0


def test_run_ablation_collects_scores_and_telemetry_per_variant():
    def evaluator(recipe, registry, case):
        if case["expected"] == "1":
            return EvaluationResult(
                score=0.8,
                telemetry=[{"component_id": "model-openai", "duration_ms": 5.0}],
            )
        return EvaluationResult(
            score=0.6,
            telemetry=[
                {"component_id": "model-openai", "duration_ms": 15.0},
                {"component_id": "tool-caller", "duration_ms": 2.0},
            ],
        )

    summary = run_ablation(
        BASE_RECIPE,
        [ParameterOverride("model-openai", "temperature", 0.7)],
        [{"prompt": "a", "expected": "1"}, {"prompt": "b", "expected": "2"}],
        evaluator,
        _registry(),
    )

    variant = summary.variants[0]
    assert [case.score for case in variant.cases] == [0.8, 0.6]
    assert variant.score == pytest.approx(0.7)
    assert variant.telemetry["total_duration_ms"] == pytest.approx(22.0)
    assert variant.telemetry["component_call_counts"] == {
        "model-openai": 2,
        "tool-caller": 1,
    }


def test_telemetry_collection_is_optional():
    def evaluator(recipe, registry, case):
        return EvaluationResult(score=1.0)

    summary = run_ablation(
        BASE_RECIPE,
        [ParameterOverride("model-openai", "temperature", 0.7)],
        [{"prompt": "x"}],
        evaluator,
        _registry(),
    )

    assert summary.variants[0].score == pytest.approx(1.0)
    assert summary.variants[0].telemetry["total_duration_ms"] == 0.0
    assert summary.variants[0].telemetry["component_call_counts"] == {}


def test_evaluator_must_return_evaluation_result():
    with pytest.raises(TypeError, match="EvaluationResult"):
        run_ablation(
            BASE_RECIPE,
            [ParameterOverride("model-openai", "temperature", 0.5)],
            [{"prompt": "x"}],
            lambda recipe, registry, case: 1.0,
            _registry(),
        )


def test_empty_eval_set_raises():
    with pytest.raises(ValueError, match="eval_cases"):
        run_ablation(
            BASE_RECIPE,
            [ParameterOverride("model-openai", "temperature", 0.5)],
            [],
            FakeEvaluator(),
            _registry(),
        )


def test_run_ablation_accepts_component_level_variants():
    registry = _registry_with_context_2()
    variables = [
        ComponentSwap("context-window", replacement_version="2.0"),
        ComponentRemove("tool-caller"),
    ]

    def evaluator(recipe, registry, case):
        return EvaluationResult(score=1.0)

    summary = run_ablation(BASE_RECIPE, variables, [{"prompt": "x"}], evaluator, registry)

    assert [v.name for v in summary.variants] == [
        "swap:context-window->context-window@2.0",
        "remove:tool-caller",
    ]
    assert "tool-caller" not in [c["id"] for c in summary.variants[1].recipe["components"]]


# --- AC4: 输出各变体的对比摘要（并排可读） ---


def test_summary_lists_each_variant_with_score_telemetry_and_cases():
    def evaluator(recipe, registry, case):
        return EvaluationResult(
            score=0.9, telemetry=[{"component_id": "model-openai", "duration_ms": 10.0}]
        )

    summary = run_ablation(
        BASE_RECIPE,
        [
            ParameterOverride("model-openai", "temperature", 0.7),
            ParameterOverride("model-openai", "temperature", 0.0),
        ],
        [{"prompt": "a"}, {"prompt": "b"}],
        evaluator,
        _registry(),
    )

    assert summary.base_recipe is BASE_RECIPE
    assert len(summary.variants) == 2
    for variant in summary.variants:
        assert variant.score == pytest.approx(0.9)
        assert len(variant.cases) == 2
        assert variant.telemetry["total_duration_ms"] == pytest.approx(20.0)
        assert variant.recipe["parameters"]["model-openai"]["temperature"] in (0.7, 0.0)


def test_comparison_table_is_side_by_side_readable():
    def evaluator(recipe, registry, case):
        return EvaluationResult(
            score=0.9, telemetry=[{"component_id": "model-openai", "duration_ms": 10.0}]
        )

    summary = run_ablation(
        BASE_RECIPE,
        [ParameterOverride("model-openai", "temperature", 0.7)],
        [{"prompt": "x"}],
        evaluator,
        _registry(),
    )

    rows = comparison_table(summary)

    assert len(rows) == 1
    row = rows[0]
    assert row["name"] == "param:model-openai.temperature"
    assert row["score"] == pytest.approx(0.9)
    assert row["total_duration_ms"] == pytest.approx(10.0)
    assert row["component_call_counts"] == {"model-openai": 1}


# --- AC5: 不依赖任何评估后端（骨架自包含） ---


def test_run_ablation_never_touches_a_scoring_backend():
    called = []

    def evaluator(recipe, registry, case):
        called.append(case)
        return EvaluationResult(score=1.0)

    run_ablation(
        BASE_RECIPE,
        [ParameterOverride("model-openai", "temperature", 0.7)],
        [{"prompt": "a"}, {"prompt": "b"}],
        evaluator,
        _registry(),
    )

    assert len(called) == 2


def test_ablation_runs_offline_end_to_end_with_generated_demo_and_telemetry(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(model_module, "OpenAI", _FakeOpenAI)

    def evaluator(recipe, registry, case):
        code = generate(recipe, registry=registry)
        reset()
        namespace = {}
        exec(code, namespace)
        agent = namespace["agent_single"]
        interceptor = TelemetryInterceptor(agent)
        interceptor.wrap_component("model-openai", namespace["model_openai"], "generate")
        interceptor.wrap_component("tool-caller", namespace["tool_caller"], "call")
        reply = interceptor.run(case["prompt"])
        score = 1.0 if reply == case["expected"] else 0.0
        return EvaluationResult(score=score, telemetry=interceptor.records())

    cases = [
        {"prompt": "what is 2 + 3?", "expected": "the answer is 5"},
        {"prompt": "what is 2 + 3?", "expected": "the answer is 5"},
    ]

    summary = run_ablation(
        BASE_RECIPE,
        [ParameterOverride("model-openai", "temperature", 0.0)],
        cases,
        evaluator,
        _registry(),
    )

    variant = summary.variants[0]
    assert variant.score == pytest.approx(1.0)
    assert variant.telemetry["component_call_counts"]["model-openai"] == 4
    assert variant.telemetry["component_call_counts"]["tool-caller"] == 2
