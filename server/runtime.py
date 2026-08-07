import os
import uuid
from dataclasses import dataclass
from types import SimpleNamespace
from threading import Lock

import components.model as model_module
from components import as_dict, reset
from components.agent import register_agent
from components.context import register_context
from components.model import register_model
from components.tools import register_tool_caller
from eval.ablation import (
    ComponentRemove,
    ComponentSwap,
    EvaluationResult,
    ParameterOverride,
    run_ablation,
)
from telemetry.interceptor import TelemetryInterceptor
from wiring import generate

# 消融跑的默认评测集：无评测集管理前端（复用商品化后端的保留位），
# 按计算器 demo 预置一条用例，让 runner 产出真实得分与遥测。
DEFAULT_EVAL_CASES = [
    {"prompt": "what is 2 + 3?", "expected": "the answer is 5"},
]

_OFFLINE_KEY = "offline-demo-key"


class _FallbackClient:
    """无 OPENAI_API_KEY 时的离线兜底模型（接口对齐 OpenAI client）。

    注入在模型组件内部，demo 管线（组件/agent/遥测）仍是真实执行，
    只是 LLM 换成确定性离线实现，保证不带 key 也能跑通全链路。
    """

    def __init__(self, **kwargs):
        self._calls = 0

    @property
    def chat(self):
        return SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        messages = kwargs.get("messages", [])
        user = next(
            (m["content"] for m in reversed(messages) if m.get("role") == "user"),
            "",
        )
        text = f"离线回复：{user}"
        self._calls += 1
        usage = SimpleNamespace(
            prompt_tokens=len(str(messages)),
            completion_tokens=len(text),
            total_tokens=len(str(messages)) + len(text),
        )
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=text))],
            usage=usage,
        )


@dataclass
class _RunningDemo:
    demo_id: str
    interceptor: TelemetryInterceptor
    recipe: dict


def _parse_value(text: str):
    try:
        return int(text)
    except ValueError:
        pass
    try:
        return float(text)
    except ValueError:
        pass
    return text


def _ablation_variables(variant: dict) -> list:
    kind = variant.get("kind")
    target = variant.get("target", "")
    if kind == "remove":
        if not target:
            raise ValueError("remove variant requires a component target")
        return [ComponentRemove(target)]
    if kind == "swap":
        if "->" in target:
            source, _, replacement = target.partition("->")
            return [ComponentSwap(source.strip(), replacement_id=replacement.strip())]
        if "@" in target:
            component_id, _, version = target.partition("@")
            return [
                ComponentSwap(component_id.strip(), replacement_version=version.strip())
            ]
        raise ValueError("swap variant needs a target like 'comp@version' or 'from->to'")
    if kind == "override":
        if "=" not in target:
            raise ValueError("override variant needs a target like 'comp.param=value'")
        comp_param, _, value_str = target.partition("=")
        component_id, _, param = comp_param.partition(".")
        if not component_id or not param:
            raise ValueError("override variant target must be 'comp.param=value'")
        return [
            ParameterOverride(
                component_id.strip(), param.strip(), _parse_value(value_str.strip())
            )
        ]
    raise ValueError(f"unknown ablation kind: {kind!r}")


def _to_contract_span(component_id: str, operation: str, start_time: float, duration_ms: float, input_tokens, output_tokens, index: int) -> dict:
    token_usage = None
    if input_tokens is not None:
        token_usage = {"input": input_tokens, "output": output_tokens}
    return {
        "id": f"{component_id}:{operation}:{index}",
        "componentId": component_id,
        "operation": operation,
        "startTimeMs": round(start_time * 1000.0),
        "durationMs": round(duration_ms, 3),
        "tokenUsage": token_usage,
        "status": "ok",
    }


def _span_to_contract(span, index: int) -> dict:
    return _to_contract_span(
        span.component_id,
        span.operation,
        span.start_time,
        span.duration_ms,
        span.input_tokens,
        span.output_tokens,
        index,
    )


def _records_to_spans(records: list) -> list:
    return [
        _to_contract_span(
            record["component_id"],
            record["gen_ai.operation.name"],
            record["start_time"],
            record["duration_ms"],
            record.get("gen_ai.usage.input_tokens"),
            record.get("gen_ai.usage.output_tokens"),
            index,
        )
        for index, record in enumerate(records)
    ]


class RuntimeUI:
    """运行界面 ↔ Python demo 的进程内运行时（U6）。

    把 wiring.generate + 组件 + telemetry + eval/ablation 编排成四个操作，
    供 HTTP 层（server/app.py）与测试直接调用。生成后的 demo 作为进程内
    对象运行（interceptor 持有真实 agent，多轮对话累积内部上下文与遥测）。
    """

    def __init__(self, *, model_client=None, eval_cases=None, registry=None):
        self._lock = Lock()
        self._model_client = model_client
        self._eval_cases = (
            list(eval_cases) if eval_cases is not None else list(DEFAULT_EVAL_CASES)
        )
        self._demos: dict[str, _RunningDemo] = {}
        self._patched = False
        self._env_key_added = False
        self._original_openai = None
        self._apply_model_mode()
        if registry is None:
            self._registry = self._rebuild_registry()
        else:
            self._registry = registry

    # --- 模型注入：测试注入假模型；无 key 时注入内置离线模型；有 key 走真实调用 ---

    def _apply_model_mode(self) -> None:
        if self._model_client is not None:
            self._patch_model(self._model_client)
        elif not os.environ.get("OPENAI_API_KEY"):
            self._patch_model(_FallbackClient)

    def _patch_model(self, client) -> None:
        self._original_openai = model_module.OpenAI
        model_module.OpenAI = client
        if not os.environ.get("OPENAI_API_KEY"):
            os.environ["OPENAI_API_KEY"] = _OFFLINE_KEY
            self._env_key_added = True
        self._patched = True

    def close(self) -> None:
        if self._patched:
            model_module.OpenAI = self._original_openai
            self._patched = False
        if self._env_key_added:
            os.environ.pop("OPENAI_API_KEY", None)
            self._env_key_added = False

    @staticmethod
    def _rebuild_registry() -> dict:
        reset()
        register_context()
        register_model()
        register_tool_caller()
        register_agent()
        return as_dict()

    @staticmethod
    def _exec_demo(recipe: dict, registry: dict):
        code = generate(recipe, registry=registry)
        reset()
        namespace = {}
        exec(code, namespace)
        agent = namespace["agent_single"]
        interceptor = TelemetryInterceptor(agent)
        interceptor.wrap_component("model-openai", namespace["model_openai"], "generate")
        interceptor.wrap_component("tool-caller", namespace["tool_caller"], "call")
        interceptor.wrap_component(
            "context-window", namespace["context_window"], "add_user_message"
        )
        return interceptor

    # --- 四个操作（契约见 contracts/demo-api.openapi.json） ---

    def generate_demo(self, demo_id: str, recipe: dict) -> dict:
        with self._lock:
            registry = self._rebuild_registry()
            interceptor = self._exec_demo(recipe, registry)
            self._demos[demo_id] = _RunningDemo(
                demo_id=demo_id, interceptor=interceptor, recipe=dict(recipe)
            )
            self._registry = as_dict()
            return {
                "demoId": demo_id,
                "status": "done",
                "message": (
                    f"demo 已生成并运行（{recipe.get('name', 'agent')}，"
                    f"{len(recipe.get('components', []))} 个组件）"
                ),
            }

    def send_chat(self, demo_id: str, messages: list) -> dict:
        with self._lock:
            demo = self._get_demo(demo_id)
            user_text = next(
                (m["content"] for m in reversed(messages) if m.get("role") == "user"),
                "",
            )
            reply = demo.interceptor.run(user_text)
            return {"reply": {"role": "assistant", "content": reply}}

    def get_telemetry(self, demo_id: str) -> dict:
        with self._lock:
            demo = self._get_demo(demo_id)
            spans = [
                _span_to_contract(span, index)
                for index, span in enumerate(demo.interceptor.spans)
            ]
            return {"spans": spans}

    def trigger_ablation(self, demo_id: str, request: dict) -> dict:
        with self._lock:
            demo = self._get_demo(demo_id)
            variables = _ablation_variables(request["variant"])
            summary = run_ablation(
                demo.recipe,
                variables,
                self._eval_cases,
                self._make_evaluator(),
                as_dict(),
            )
            results = [
                {
                    "variant": request["variant"],
                    "scores": {"score": round(variant.score, 4)},
                    "spans": _records_to_spans(
                        [
                            record
                            for case_result in variant.cases
                            for record in case_result.telemetry
                        ]
                    ),
                }
                for variant in summary.variants
            ]
            return {
                "run": {
                    "runId": f"ablation-{uuid.uuid4().hex[:8]}",
                    "status": "done",
                    "results": results,
                }
            }

    # --- 内部工具 ---

    def _get_demo(self, demo_id: str) -> _RunningDemo:
        demo = self._demos.get(demo_id)
        if demo is None:
            raise KeyError(f"demo {demo_id!r} not running; generate it first")
        return demo

    def _make_evaluator(self):
        def evaluate(recipe, registry, case):
            interceptor = self._exec_demo(recipe, registry)
            reply = interceptor.run(case["prompt"])
            expected = case.get("expected")
            score = 1.0 if (expected is None or reply == expected) else 0.0
            return EvaluationResult(score=score, telemetry=interceptor.records())

        return evaluate
