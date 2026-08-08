"""消融编排：运行时注入（ADR-0005），不再用配方重建变体。

旧版把消融变量 apply 到配方（recipe）上产出变体配方，再经接线引擎重建 demo。
ADR-0005 废除配方与接线后，变体 = demo 代码 + 对运行中组件实例的注入操作：
- ParameterOverride → 组件实例 set_param
- ComponentRemove → agent.disable_part（接受空零件）
- ComponentSwap → 构造替换实例 + agent.replace_part

本模块只做编排与汇总，不碰运行时/注册表细节；注入面收敛为 VariantDemo
协议（set_param/remove_component/replace_component），由运行时侧实现。

取舍说明：真正的"同一实例注入后恢复"最优雅但要逐变体改回、易漏状态；
这里采用务实中间态——每个 (变体, 评测用例) 从 demo 代码重新构建一次全新
实例再注入，避免跨用例上下文/遥测污染，也不再依赖配方，满足 ADR-0005。
"""

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Protocol


class VariantDemo(Protocol):
    """消融变体的运行时注入句柄：组件统一注入协议的机械调用面。

    builder 产出的 demo 已执行 demo 代码并接入遥测，注入方法直接作用于
    运行中的组件实例；evaluator 通过 demo.run() 跑用例、demo.records()
    取本次遥测。
    """

    def set_param(self, component_id: str, name: str, value) -> None: ...
    def remove_component(self, component_id: str) -> None: ...
    def replace_component(
        self,
        component_id: str,
        replacement_id: str | None,
        replacement_version: str | None,
    ) -> None: ...
    def run(self, prompt: str) -> str: ...
    def records(self) -> list: ...


@dataclass(frozen=True)
class AblationVariable:
    component_id: str

    @property
    def label(self) -> str:
        raise NotImplementedError

    def apply(self, demo: VariantDemo) -> None:
        """对运行中的 demo 实例做一次注入，产出该变量的变体。"""
        raise NotImplementedError


@dataclass(frozen=True)
class ComponentSwap(AblationVariable):
    replacement_id: str | None = None
    replacement_version: str | None = None

    @property
    def label(self) -> str:
        if self.replacement_id is not None:
            return f"swap:{self.component_id}->{self.replacement_id}"
        return f"swap:{self.component_id}->{self.component_id}@{self.replacement_version}"

    def apply(self, demo: VariantDemo) -> None:
        if self.replacement_id is None and self.replacement_version is None:
            raise ValueError(
                f"ComponentSwap for {self.component_id!r} needs replacement_id "
                "or replacement_version"
            )
        demo.replace_component(
            self.component_id, self.replacement_id, self.replacement_version
        )


@dataclass(frozen=True)
class ComponentRemove(AblationVariable):
    @property
    def label(self) -> str:
        return f"remove:{self.component_id}"

    def apply(self, demo: VariantDemo) -> None:
        demo.remove_component(self.component_id)


@dataclass(frozen=True)
class ParameterOverride(AblationVariable):
    parameter: str
    value: object

    @property
    def label(self) -> str:
        return f"param:{self.component_id}.{self.parameter}"

    def apply(self, demo: VariantDemo) -> None:
        demo.set_param(self.component_id, self.parameter, self.value)


@dataclass
class EvaluationResult:
    score: float
    telemetry: list = field(default_factory=list)


@dataclass
class CaseResult:
    case: dict
    score: float
    telemetry: list = field(default_factory=list)


@dataclass
class VariantResult:
    name: str
    score: float
    telemetry: dict
    cases: list = field(default_factory=list)


@dataclass
class AblationSummary:
    variants: list = field(default_factory=list)


def run_ablation_on_demo(
    builder,
    variables: list[AblationVariable],
    eval_cases: list[dict],
    evaluator,
) -> AblationSummary:
    """运行时注入式消融主入口（ADR-0005）：代码重建 + 注入，不再用配方。

    builder: () -> 新的已运行 demo 句柄（VariantDemo）。每个 (变体, 用例)
       重新构建一次，保证变体互不串扰、遥测按用例隔离。
    evaluator: (demo, case) -> EvaluationResult；demo 已由变量注入完毕，
       可直接 demo.run(case["prompt"]) 并返回得分与遥测。
    """
    if not eval_cases:
        raise ValueError("eval_cases must be a non-empty list")
    variant_results = []
    for variable in variables:
        case_results = []
        for case in eval_cases:
            demo = builder()
            variable.apply(demo)
            result = evaluator(demo, case)
            if not isinstance(result, EvaluationResult):
                raise TypeError(
                    f"evaluator must return EvaluationResult, got {type(result).__name__}"
                )
            case_results.append(
                CaseResult(
                    case=case, score=result.score, telemetry=list(result.telemetry)
                )
            )
        variant_results.append(
            VariantResult(
                name=variable.label,
                score=_mean([r.score for r in case_results]),
                telemetry=_summarize_telemetry(r.telemetry for r in case_results),
                cases=case_results,
            )
        )
    return AblationSummary(variants=variant_results)


def _mean(scores: list) -> float:
    return sum(scores) / len(scores)


def _summarize_telemetry(records_per_case) -> dict:
    total_duration_ms = 0.0
    total_tokens = 0
    call_counts = defaultdict(int)
    for records in records_per_case:
        for record in records:
            total_duration_ms += record.get("duration_ms", 0.0)
            total_tokens += record.get("gen_ai.usage.total_tokens", 0)
            call_counts[record.get("component_id", "unknown")] += 1
    return {
        "total_duration_ms": round(total_duration_ms, 6),
        "component_call_counts": dict(call_counts),
        "total_tokens": total_tokens,
    }


def comparison_table(summary: AblationSummary) -> list[dict]:
    return [
        {
            "name": variant.name,
            "score": variant.score,
            "total_duration_ms": variant.telemetry["total_duration_ms"],
            "total_tokens": variant.telemetry["total_tokens"],
            "component_call_counts": variant.telemetry["component_call_counts"],
        }
        for variant in summary.variants
    ]
