import os
import uuid
from dataclasses import dataclass
from types import SimpleNamespace
from threading import Lock

from components import as_dict, reset
from components.agent import register_agent
from components.context import register_context
from components.model import register_model, register_ollama_model
from components.tools import register_tool_caller
from eval.ablation import (
    ComponentRemove,
    ComponentSwap,
    EvaluationResult,
    ParameterOverride,
    run_ablation,
)
from openai import OpenAI
from server.config_store import ConfigStore
from telemetry.interceptor import TelemetryInterceptor
from wiring import generate

# 消融跑的默认评测集：无评测集管理前端（复用商品化后端的保留位），
# 按计算器 demo 预置一条用例，让 runner 产出真实得分与遥测。
DEFAULT_EVAL_CASES = [
    {"prompt": "what is 2 + 3?", "expected": "the answer is 5"},
]

# 环境变量占位 key：执行胶水代码时 OpenAIModel 构造默认 client 会读
# OPENAI_API_KEY，离线场景用占位值兜底（注入的 client 随即替换，见 _exec_demo）。
_ENV_PLACEHOLDER_KEY = "offline-demo-key"


class _FallbackClient:
    """无 api key 时的离线兜底模型（接口对齐 OpenAI client）。

    client 注入在模型组件内部，demo 管线（组件/agent/遥测）仍是真实执行，
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

    把 wiring.generate + 组件 + telemetry + eval/ablation 编排成六个操作，
    供 HTTP 层（server/app.py）与测试直接调用。生成后的 demo 作为进程内
    对象运行（interceptor 持有真实 agent，多轮对话累积内部上下文与遥测）。

    运行环境配置（api key、默认模型、base_url 等）由 ConfigStore 持久化：
    生成 demo 时配方缺省的参数回退持久化配置；api key 走 client 注入，
    不再全局 monkey-patch model_module.OpenAI（见 #24 review 评论）。
    """

    def __init__(self, *, model_client=None, eval_cases=None, registry=None, config_store=None):
        self._lock = Lock()
        self._config_store = config_store if config_store is not None else ConfigStore()
        self._eval_cases = (
            list(eval_cases) if eval_cases is not None else list(DEFAULT_EVAL_CASES)
        )
        self._demos: dict[str, _RunningDemo] = {}
        # 模型 client 注入：显式注入（测试）> 持久化配置 key > 环境变量 > 离线兜底。
        self._model_client = self._resolve_model_client(model_client)
        if registry is None:
            self._registry = self._rebuild_registry()
        else:
            self._registry = registry

    # --- 模型 client 注入（替代 _patch_model 全局 monkey-patch） ---

    def _resolve_model_client(self, model_client):
        if model_client is not None:
            # 兼容传类（如测试的假 client 类）与传实例两种注入方式
            return model_client() if isinstance(model_client, type) else model_client
        api_key = self._config_store.api_key
        if api_key:
            kwargs = {"api_key": api_key}
            if self._config_store.base_url:
                kwargs["base_url"] = self._config_store.base_url
            return OpenAI(**kwargs)
        env_key = os.environ.get("OPENAI_API_KEY")
        if env_key:
            return OpenAI(api_key=env_key)
        return _FallbackClient()

    def close(self) -> None:
        """client 注入方案下没有全局状态需要清理，保留方法兼容既有调用方。"""
        return None

    @staticmethod
    def _rebuild_registry() -> dict:
        reset()
        register_context()
        register_model()
        register_ollama_model()
        register_tool_caller()
        register_agent()
        return as_dict()

    @staticmethod
    def _exec_demo(recipe: dict, registry: dict, model_client) -> TelemetryInterceptor:
        code = generate(recipe, registry=registry)
        reset()
        namespace = {}
        # 胶水代码里 OpenAIModel() 构造默认 client 会读 OPENAI_API_KEY；
        # 执行后 client 立即被注入替换，因此这里只需保证环境里有占位 key
        # （离线场景用占位值兜底，避免 _default_client 抛错），随后恢复环境。
        # 空字符串视为未配置：同样需要占位兜底。
        had_key = bool(os.environ.get("OPENAI_API_KEY"))
        if not had_key:
            os.environ["OPENAI_API_KEY"] = _ENV_PLACEHOLDER_KEY
        try:
            exec(code, namespace)
        finally:
            if not had_key:
                os.environ.pop("OPENAI_API_KEY", None)
        agent = namespace["agent_single"]
        interceptor = TelemetryInterceptor(agent)
        # client 注入：把 runtime 持有的模型 client 装进配方里所有 role=model 的
        # 组件实例（model_openai / model_ollama），不全局替换 module.OpenAI
        # （见 #24 review 评论）。胶水代码变量名 = 组件 id 的连字符换下划线。
        for entry in recipe.get("components", []):
            spec = registry.get(
                (entry["id"], entry.get("version", "1.0"))
            )
            if spec is None or spec.role != "model":
                continue
            var_name = entry["id"].replace("-", "_")
            instance = namespace[var_name]
            instance._client = model_client
            interceptor.wrap_component(entry["id"], instance, "generate")
        interceptor.wrap_component("tool-caller", namespace["tool_caller"], "call")
        interceptor.wrap_component(
            "context-window", namespace["context_window"], "add_user_message"
        )
        return interceptor

    # --- 运行环境配置（契约见 contracts/demo-api.openapi.json） ---

    def get_config(self) -> dict:
        """GET /config：api key 掩码回显，完整值不出 server。"""
        with self._lock:
            return self._config_store.view()

    def update_config(self, payload: dict) -> dict:
        """PUT /config：合并写入并落盘，返回掩码视图。"""
        with self._lock:
            result = self._config_store.update(payload)
            # 配置变更（api key / base_url）后重建模型 client，避免改配置要重启。
            self._model_client = self._resolve_model_client(None)
            return result

    def list_components(self) -> dict:
        """GET /components：返回注册表里的组件契约清单。"""
        with self._lock:
            self._registry = self._rebuild_registry()
            specs = sorted(as_dict().values(), key=lambda s: (s.id, s.version))
            return {"components": [self._component_contract(spec) for spec in specs]}

    @staticmethod
    def _component_contract(spec) -> dict:
        return {
            "id": spec.id,
            "version": spec.version,
            "role": spec.role,
            "description": spec.description,
            "inputs": [{"name": p.name, "type": p.type} for p in spec.inputs],
            "outputs": [{"name": p.name, "type": p.type} for p in spec.outputs],
            "params": {
                name: {
                    "type": param.type,
                    "default": param.default,
                    "enum": param.enum,
                    "min": param.min,
                    "max": param.max,
                }
                for name, param in spec.params.items()
            },
        }

    # --- 四个操作（契约见 contracts/demo-api.openapi.json） ---

    def _apply_config_defaults(self, recipe: dict) -> dict:
        """配方未提供的参数回退持久化配置（组件级默认参数）。

        只作用于配方选用的组件；配方显式给出的参数优先于持久化默认值。
        """
        component_ids = {entry.get("id") for entry in recipe.get("components", [])}
        params = dict(recipe.get("parameters") or {})
        changed = False
        for component_id in sorted(component_ids):
            defaults = self._config_store.component_params.get(component_id)
            if not defaults:
                continue
            existing = dict(params.get(component_id, {}))
            merged = dict(defaults)
            merged.update(existing)  # 配方显式参数优先
            if component_id not in params or merged != existing:
                params[component_id] = merged
                changed = True
        if not changed:
            return recipe
        recipe = dict(recipe)
        recipe["parameters"] = params
        return recipe

    def generate_demo(self, demo_id: str, recipe: dict) -> dict:
        with self._lock:
            recipe = self._apply_config_defaults(dict(recipe))
            registry = self._rebuild_registry()
            interceptor = self._exec_demo(recipe, registry, self._model_client)
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
            demo = self._demos.get(demo_id)
            if demo is None:
                # demo 未生成时遥测天然为空（如 web 启动即轮询），返回 200 而非 404。
                return {"spans": []}
            spans = [
                _span_to_contract(span, index)
                for index, span in enumerate(demo.interceptor.spans)
            ]
            return {"spans": spans}

    def trigger_ablation(self, demo_id: str, request: dict) -> dict:
        with self._lock:
            demo = self._get_demo(demo_id)
            variant = request.get("variant")
            if not isinstance(variant, dict):
                raise ValueError("ablation request requires a variant object")
            variables = _ablation_variables(variant)
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
            interceptor = self._exec_demo(recipe, registry, self._model_client)
            reply = interceptor.run(case["prompt"])
            expected = case.get("expected")
            score = 1.0 if (expected is None or reply == expected) else 0.0
            return EvaluationResult(score=score, telemetry=interceptor.records())

        return evaluate
