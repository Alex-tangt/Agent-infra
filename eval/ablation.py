import copy
from collections import defaultdict
from dataclasses import dataclass, field

from recipe import validate as validate_recipe


@dataclass(frozen=True)
class AblationVariable:
    component_id: str

    @property
    def label(self) -> str:
        raise NotImplementedError

    def apply(self, recipe: dict) -> dict:
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

    def apply(self, recipe: dict) -> dict:
        if self.replacement_id is None and self.replacement_version is None:
            raise ValueError(
                f"ComponentSwap for {self.component_id!r} needs replacement_id "
                "or replacement_version"
            )
        variant = _copy_recipe(recipe)
        new_id = self.replacement_id or self.component_id
        if new_id != self.component_id and any(
            c["id"] == new_id for c in variant["components"]
        ):
            raise ValueError(
                f"replacement component {new_id!r} already exists in recipe"
            )
        for component in variant["components"]:
            if component["id"] != self.component_id:
                continue
            if new_id != self.component_id:
                component["id"] = new_id
            if self.replacement_version is not None:
                component["version"] = self.replacement_version
            break
        else:
            raise ValueError(f"component {self.component_id!r} not found in recipe")
        if new_id != self.component_id:
            for connection in variant["connections"]:
                if connection.get("from") == self.component_id:
                    connection["from"] = new_id
                if connection.get("to") == self.component_id:
                    connection["to"] = new_id
            if self.component_id in variant["parameters"]:
                variant["parameters"][new_id] = variant["parameters"].pop(
                    self.component_id
                )
        return variant


@dataclass(frozen=True)
class ComponentRemove(AblationVariable):
    @property
    def label(self) -> str:
        return f"remove:{self.component_id}"

    def apply(self, recipe: dict) -> dict:
        variant = _copy_recipe(recipe)
        if not any(c["id"] == self.component_id for c in variant["components"]):
            raise ValueError(f"component {self.component_id!r} not found in recipe")
        variant["components"] = [
            c for c in variant["components"] if c["id"] != self.component_id
        ]
        variant["connections"] = [
            c
            for c in variant["connections"]
            if c.get("from") != self.component_id and c.get("to") != self.component_id
        ]
        variant["parameters"].pop(self.component_id, None)
        return variant


@dataclass(frozen=True)
class ParameterOverride(AblationVariable):
    parameter: str
    value: object

    @property
    def label(self) -> str:
        return f"param:{self.component_id}.{self.parameter}"

    def apply(self, recipe: dict) -> dict:
        variant = _copy_recipe(recipe)
        if not any(c["id"] == self.component_id for c in variant["components"]):
            raise ValueError(f"component {self.component_id!r} not found in recipe")
        variant["parameters"].setdefault(self.component_id, {})[self.parameter] = (
            self.value
        )
        return variant


def _copy_recipe(recipe: dict) -> dict:
    return copy.deepcopy(recipe)


@dataclass
class Variant:
    name: str
    recipe: dict


def build_variants(base_recipe: dict, variables: list[AblationVariable]) -> list[Variant]:
    return [
        Variant(name=variable.label, recipe=variable.apply(base_recipe))
        for variable in variables
    ]


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
    recipe: dict
    score: float
    telemetry: dict
    cases: list = field(default_factory=list)


@dataclass
class AblationSummary:
    base_recipe: dict
    variants: list = field(default_factory=list)


def run_ablation(
    base_recipe: dict,
    variables: list[AblationVariable],
    eval_cases: list[dict],
    evaluator,
    registry: dict,
) -> AblationSummary:
    if not eval_cases:
        raise ValueError("eval_cases must be a non-empty list")
    variant_results = []
    for variant in build_variants(base_recipe, variables):
        validate_recipe(variant.recipe, registry=registry)
        case_results = []
        for case in eval_cases:
            result = evaluator(variant.recipe, registry, case)
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
                name=variant.name,
                recipe=variant.recipe,
                score=_mean([r.score for r in case_results]),
                telemetry=_summarize_telemetry(r.telemetry for r in case_results),
                cases=case_results,
            )
        )
    return AblationSummary(base_recipe=base_recipe, variants=variant_results)


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
