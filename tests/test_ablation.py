from pathlib import Path
from types import SimpleNamespace

import pytest

from components import reset
from eval.ablation import (
    ComponentRemove,
    ComponentSwap,
    EvaluationResult,
    ParameterOverride,
    comparison_table,
    run_ablation_on_demo,
)
from server.runtime import RuntimeUI

REPO_ROOT = Path(__file__).resolve().parent.parent
DEMO_CODE = (REPO_ROOT / "demos" / "calculator_agent.py").read_text(encoding="utf-8")


class _FakeOpenAI:
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


class _FakeDemo:
    """VariantDemo 的测试替身：记录注入调用，供断言变量协议面。"""

    def __init__(self):
        self.set_params = []
        self.removed = []
        self.replaced = []

    def set_param(self, component_id, name, value):
        self.set_params.append((component_id, name, value))

    def remove_component(self, component_id):
        self.removed.append(component_id)

    def replace_component(self, component_id, replacement_id, replacement_version=None):
        self.replaced.append((component_id, replacement_id, replacement_version))


@pytest.fixture(autouse=True)
def clean_registry():
    reset()
    yield
    reset()


def _new_runtime(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    return RuntimeUI(model_client=_FakeOpenAI)


# --- AC1: 消融变量 = 对运行中 demo 的注入操作（不再改配方） ---


def test_parameter_override_applies_set_param():
    demo = _FakeDemo()

    ParameterOverride("model-openai", "temperature", 0.7).apply(demo)

    assert demo.set_params == [("model-openai", "temperature", 0.7)]


def test_component_remove_applies_remove():
    demo = _FakeDemo()

    ComponentRemove("tool-caller").apply(demo)

    assert demo.removed == ["tool-caller"]


def test_component_swap_applies_replace():
    demo = _FakeDemo()

    ComponentSwap("model-openai", replacement_id="model-ollama").apply(demo)

    assert demo.replaced == [("model-openai", "model-ollama", None)]


def test_component_swap_version_applies_replace():
    demo = _FakeDemo()

    ComponentSwap("model-openai", replacement_version="2.0").apply(demo)

    assert demo.replaced == [("model-openai", None, "2.0")]


def test_component_swap_without_replacement_is_rejected():
    demo = _FakeDemo()

    with pytest.raises(ValueError, match="replacement_id"):
        ComponentSwap("model-openai").apply(demo)


def test_variable_labels_read_side_by_side():
    assert ParameterOverride("model-openai", "temperature", 0.7).label == (
        "param:model-openai.temperature"
    )
    assert ComponentRemove("tool-caller").label == "remove:tool-caller"
    assert ComponentSwap("model-openai", replacement_id="model-ollama").label == (
        "swap:model-openai->model-ollama"
    )
    assert ComponentSwap("context-window", replacement_version="2.0").label == (
        "swap:context-window->context-window@2.0"
    )


# --- AC2: run_ablation_on_demo 对每个变体跑同一评测集，收集得分 + 遥测 ---


def test_run_ablation_evaluates_every_case_for_every_variable_with_same_set():
    cases = [
        {"prompt": "what is 2 + 3?", "expected": "5"},
        {"prompt": "hi", "expected": "hi"},
    ]
    variables = [
        ParameterOverride("model-openai", "temperature", 0.7),
        ParameterOverride("model-openai", "temperature", 0.0),
    ]
    built = []

    def builder():
        demo = _FakeDemo()
        built.append(demo)
        return demo

    def evaluator(demo, case):
        return EvaluationResult(
            score=1.0,
            telemetry=[{"component_id": "model-openai", "duration_ms": 10.0}],
        )

    summary = run_ablation_on_demo(builder, variables, cases, evaluator)

    assert len(summary.variants) == 2
    assert [v.name for v in summary.variants] == [
        "param:model-openai.temperature",
        "param:model-openai.temperature",
    ]
    # 每个 (变体, 用例) 都从代码重建一次全新实例再注入
    assert len(built) == 4
    assert all(demo.set_params == [("model-openai", "temperature", v.value)]
               for demo, v in zip(built, [variables[0]] * 2 + [variables[1]] * 2))


def test_run_ablation_collects_scores_and_telemetry_per_variant():
    def builder():
        return _FakeDemo()

    def evaluator(demo, case):
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

    summary = run_ablation_on_demo(
        builder,
        [ParameterOverride("model-openai", "temperature", 0.7)],
        [{"prompt": "a", "expected": "1"}, {"prompt": "b", "expected": "2"}],
        evaluator,
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
    def builder():
        return _FakeDemo()

    def evaluator(demo, case):
        return EvaluationResult(score=1.0)

    summary = run_ablation_on_demo(
        builder,
        [ParameterOverride("model-openai", "temperature", 0.7)],
        [{"prompt": "x"}],
        evaluator,
    )

    assert summary.variants[0].score == pytest.approx(1.0)
    assert summary.variants[0].telemetry["total_duration_ms"] == 0.0
    assert summary.variants[0].telemetry["component_call_counts"] == {}


def test_evaluator_must_return_evaluation_result():
    def builder():
        return _FakeDemo()

    with pytest.raises(TypeError, match="EvaluationResult"):
        run_ablation_on_demo(
            builder,
            [ParameterOverride("model-openai", "temperature", 0.5)],
            [{"prompt": "x"}],
            lambda demo, case: 1.0,
        )


def test_empty_eval_set_raises():
    def builder():
        return _FakeDemo()

    with pytest.raises(ValueError, match="eval_cases"):
        run_ablation_on_demo(
            builder,
            [ParameterOverride("model-openai", "temperature", 0.5)],
            [],
            lambda demo, case: EvaluationResult(score=1.0),
        )


# --- AC3: 对 calculator demo 做真实运行时注入（不依赖配方） ---


def _demo_builder(runtime, demo_id):
    demo = runtime._demos[demo_id]
    registry = runtime._rebuild_registry()
    return runtime._make_demo_builder(demo.code, demo.component_ids, registry)


def test_parameter_override_mutates_live_instance_and_rebuild_restores(monkeypatch):
    runtime = _new_runtime(monkeypatch)
    try:
        runtime.generate_demo_from_code("demo", DEMO_CODE)
        builder = _demo_builder(runtime, "demo")

        demo = builder()
        ParameterOverride("model-openai", "temperature", 0.3).apply(demo)
        assert demo._executed.instances["model-openai"].temperature == 0.3

        # 变体重建 = 全新实例，温度回到契约默认值，变体之间互不串扰
        fresh = builder()
        assert fresh._executed.instances["model-openai"].temperature == 0.7
    finally:
        runtime.close()


def test_component_remove_disables_tools_on_live_agent(monkeypatch):
    runtime = _new_runtime(monkeypatch)
    try:
        runtime.generate_demo_from_code("demo", DEMO_CODE)
        builder = _demo_builder(runtime, "demo")

        demo = builder()
        ComponentRemove("tool-caller").apply(demo)
        reply = demo.run("what is 2 + 3?")
        records = demo.records()

        assert reply == "the answer is 5"
        assert "tool-caller" not in {r["component_id"] for r in records}
        assert "model-openai" in {r["component_id"] for r in records}
    finally:
        runtime.close()


def test_component_swap_replaces_model_on_live_agent(monkeypatch):
    runtime = _new_runtime(monkeypatch)
    try:
        runtime.generate_demo_from_code("demo", DEMO_CODE)
        builder = _demo_builder(runtime, "demo")

        demo = builder()
        ComponentSwap("model-openai", replacement_id="model-ollama").apply(demo)
        reply = demo.run("what is 2 + 3?")
        records = demo.records()

        assert reply == "the answer is 5"
        component_ids = {r["component_id"] for r in records}
        assert "model-ollama" in component_ids
        assert "model-openai" not in component_ids
    finally:
        runtime.close()


def test_ablation_runs_offline_end_to_end_from_demo_code(monkeypatch):
    runtime = _new_runtime(monkeypatch)
    try:
        runtime.generate_demo_from_code("demo", DEMO_CODE)
        res = runtime.trigger_ablation(
            "demo",
            {
                "variant": {
                    "kind": "override",
                    "target": "model-openai.temperature=0.0",
                    "description": "覆盖温度",
                }
            },
        )

        run = res["run"]
        assert run["status"] == "done"
        assert len(run["results"]) == 1
        result = run["results"][0]
        assert result["scores"]["score"] == 1.0
        assert len(result["spans"]) > 0
    finally:
        runtime.close()


# --- AC4: 输出各变体的对比摘要（并排可读） ---


def test_comparison_table_is_side_by_side_readable():
    def builder():
        return _FakeDemo()

    def evaluator(demo, case):
        return EvaluationResult(
            score=0.9, telemetry=[{"component_id": "model-openai", "duration_ms": 10.0}]
        )

    summary = run_ablation_on_demo(
        builder,
        [ParameterOverride("model-openai", "temperature", 0.7)],
        [{"prompt": "x"}],
        evaluator,
    )

    rows = comparison_table(summary)

    assert len(rows) == 1
    row = rows[0]
    assert row["name"] == "param:model-openai.temperature"
    assert row["score"] == pytest.approx(0.9)
    assert row["total_duration_ms"] == pytest.approx(10.0)
    assert row["component_call_counts"] == {"model-openai": 1}
