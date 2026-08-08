import os
import uuid
from dataclasses import dataclass
from types import SimpleNamespace
from threading import Lock

from components import as_dict, reset
from components.agent import Agent, register_agent
from components.context import ContextWindow, register_context
from components.model import OpenAIModel, register_model, register_ollama_model
from components.model.ollama import OllamaModel
from components.tools import ToolCaller, register_tool_caller
from eval.ablation import (
    ComponentRemove,
    ComponentSwap,
    EvaluationResult,
    ParameterOverride,
    run_ablation_on_demo,
)
from openai import OpenAI
from server.config_store import ConfigStore
from telemetry.interceptor import TelemetryInterceptor
from validation.code_check import check_demo_code

# 消融跑的默认评测集：无评测集管理前端（复用商品化后端的保留位），
# 按计算器 demo 预置一条用例，让 runner 产出真实得分与遥测。
DEFAULT_EVAL_CASES = [
    {"prompt": "what is 2 + 3?", "expected": "the answer is 5"},
]

# 环境变量占位 key：执行胶水代码时 OpenAIModel 构造默认 client 会读
# OPENAI_API_KEY，离线场景用占位值兜底（注入的 client 随即替换，见 _exec_demo_from_code）。
_ENV_PLACEHOLDER_KEY = "offline-demo-key"

# 组件类名 → 类对象的映射：消融 ComponentSwap 构建替换实例用（demo 代码未导入的
# 组件类也能换入；组件注册表的 register_* 与本表共用同一批类定义）。
_CLASS_BY_NAME = {
    cls.__name__: cls
    for cls in (Agent, ContextWindow, OpenAIModel, OllamaModel, ToolCaller)
}

# 组件 role → 遥测包装的调用名（与 _exec_demo_from_code 的注入分工一致）。
_CALL_BY_ROLE = {
    "model": "generate",
    "tools": "call",
    "context": "add_user_message",
}


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
    code: str
    component_ids: set


@dataclass
class _ExecutedDemo:
    """一次 exec demo 代码的产物：interceptor（含遥测）+ agent + 组件实例表。

    实例表按组件 id 索引，供消融运行时注入按 id 定位组件实例。
    """

    interceptor: TelemetryInterceptor
    agent: object
    instances: dict
    namespace: dict


class _AblationDemo:
    """消融变体句柄：对已 exec 的 demo 实例做运行时注入（VariantDemo 协议实现）。

    注入走组件统一协议（set_param / replace_part / disable_part），不读任何
    逐组件声明；替换组件的构造用注册表契约的默认参数 + demo 已导入（或本库）
    的类，model 角色额外注入 runtime 持有的 client。
    """

    def __init__(self, executed: _ExecutedDemo, registry: dict, model_client):
        self._executed = executed
        self._registry = registry
        self._model_client = model_client

    def run(self, prompt: str) -> str:
        return self._executed.interceptor.run(prompt)

    def records(self) -> list:
        return self._executed.interceptor.records()

    def set_param(self, component_id: str, name: str, value) -> None:
        instance = self._require_instance(component_id)
        setter = getattr(instance, "set_param", None)
        if setter is None:
            raise ValueError(f"组件 {component_id!r} 未实现注入协议 set_param")
        setter(name, value)

    def remove_component(self, component_id: str) -> None:
        spec = self._lookup_spec(component_id, None)
        self._executed.agent.disable_part(spec.role)

    def replace_component(
        self,
        component_id: str,
        replacement_id: str | None,
        replacement_version: str | None,
    ) -> None:
        spec = self._lookup_spec(component_id, None)
        new_id = replacement_id or component_id
        replacement_spec = self._lookup_spec(new_id, replacement_version)
        if replacement_spec.role != spec.role:
            raise ValueError(
                f"替换组件 {new_id!r} role={replacement_spec.role}，"
                f"与 {component_id!r} 的 role={spec.role} 不匹配"
            )
        instance = self._build_instance(replacement_spec)
        self._executed.agent.replace_part(spec.role, instance)
        call_name = _CALL_BY_ROLE.get(spec.role)
        if call_name is not None:
            self._executed.interceptor.wrap_component(new_id, instance, call_name)

    # --- 内部工具 ---

    def _require_instance(self, component_id: str) -> object:
        instance = self._executed.instances.get(component_id)
        if instance is None:
            raise ValueError(f"组件 {component_id!r} 不在 demo 运行实例中")
        return instance

    def _lookup_spec(self, component_id: str, version: str | None):
        if version is not None:
            spec = self._registry.get((component_id, version))
            if spec is None:
                raise ValueError(f"组件 {component_id!r}@{version} 不在注册表")
            return spec
        matches = [
            spec
            for (_cid, _version), spec in self._registry.items()
            if spec.id == component_id
        ]
        if not matches:
            raise ValueError(f"组件 {component_id!r} 不在注册表")
        return matches[0]

    def _build_instance(self, spec):
        cls = self._executed.namespace.get(spec.class_name) or _CLASS_BY_NAME.get(
            spec.class_name
        )
        if cls is None:
            raise ValueError(
                f"找不到组件类 {spec.class_name!r}，无法构建替换实例"
            )
        params = {name: param.default for name, param in spec.params.items()}
        if spec.role == "model":
            return cls(client=self._model_client, **params)
        return cls(**params)


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
    """运行界面 ↔ Python demo 的进程内运行时（U6，ADR-0005）。

    把 demo 代码执行 + 组件 + telemetry + eval/ablation 编排成六个操作，
    供 HTTP 层（server/app.py）与测试直接调用。demo 代码是唯一真相源，
    运行时直接 exec 代码，作为进程内对象运行（interceptor 持有真实 agent，
    多轮对话累积内部上下文与遥测）。

    运行环境配置（api key、默认模型、base_url 等）由 ConfigStore 持久化；
    api key 走 client 注入，不再全局 monkey-patch model_module.OpenAI
    （见 #24 review 评论）。消融走运行时注入（set_param/replace_part/disable_part），
    从 demo 代码重建变体，不再传配方。
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
    def _find_instance(namespace: dict, spec) -> object | None:
        """按组件实例在 namespace 里的绑定位置找实例。

        优先用组件 id 连字符换下划线的约定变量名（model-openai -> model_openai），
        找不到再回退扫描 class_name 匹配的实例，覆盖演示代码改名绑定的情况。
        """
        var_name = spec.id.replace("-", "_")
        instance = namespace.get(var_name)
        if instance is not None and type(instance).__name__ == spec.class_name:
            return instance
        for value in namespace.values():
            if type(value).__name__ == spec.class_name:
                return value
        return None

    @staticmethod
    def _exec_demo_from_code(
        code: str, registry: dict, model_client, used_ids: set
    ) -> _ExecutedDemo:
        """执行 demo 代码并注入 client / 包装遥测（ADR-0005 主路径，不经接线引擎）。

        使用组件集合由 code_check 静态分析得出，注入与遥测按组件 role 分工：
        role=model 注入 client + 包装 generate；role=tools 包装 call；
        role=context 包装 add_user_message；role=agent 作为对话入口实例。
        实例表（instances）按组件 id 索引，供消融运行时注入定位组件。
        """
        reset()
        namespace = {}
        # demo 代码里 OpenAIModel() 构造默认 client 读 OPENAI_API_KEY，
        # exec 后 client 立即被注入替换，这里只需占位兜底避免构造抛错。
        had_key = bool(os.environ.get("OPENAI_API_KEY"))
        if not had_key:
            os.environ["OPENAI_API_KEY"] = _ENV_PLACEHOLDER_KEY
        try:
            exec(code, namespace)
        finally:
            if not had_key:
                os.environ.pop("OPENAI_API_KEY", None)

        specs = {
            spec.id: spec
            for (_cid, _version), spec in registry.items()
            if spec.id in used_ids
        }
        agent_id = next(
            (
                cid
                for cid in sorted(used_ids)
                if specs.get(cid) and specs[cid].role == "agent"
            ),
            None,
        )
        if agent_id is None:
            raise ValueError(
                "demo 代码未使用任何 role=agent 组件，运行时需要 agent 实例承载对话"
            )
        agent = RuntimeUI._find_instance(namespace, specs[agent_id])
        interceptor = TelemetryInterceptor(agent)
        instances = {agent_id: agent}
        for component_id in sorted(used_ids):
            spec = specs.get(component_id)
            if spec is None or spec.role == "agent":
                continue
            instance = RuntimeUI._find_instance(namespace, spec)
            if instance is None:
                continue
            instances[component_id] = instance
            if spec.role == "model":
                instance._client = model_client
                interceptor.wrap_component(component_id, instance, "generate")
            elif spec.role == "tools":
                interceptor.wrap_component(component_id, instance, "call")
            elif spec.role == "context":
                interceptor.wrap_component(component_id, instance, "add_user_message")
        return _ExecutedDemo(
            interceptor=interceptor, agent=agent, instances=instances, namespace=namespace
        )

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

    def generate_demo_from_code(self, demo_id: str, code: str) -> dict:
        """ADR-0005 主路径（唯一生成入口）：demo 代码是唯一真相源，运行时直接收代码运行。

        构造调用先经 validation.code_check 做 AST 校验（参数名/枚举/范围比对
        registry），校验不过抛 ValueError（消息含具体 issue）。生成后的 demo
        保存代码与使用组件集合，供消融按代码重建变体。
        """
        with self._lock:
            registry = self._rebuild_registry()
            result = check_demo_code(code, registry)
            if not result.ok:
                details = "; ".join(
                    f"第 {issue.lineno} 行 {issue.message}"
                    for issue in result.issues
                )
                raise ValueError(f"demo 代码校验未通过: {details}")
            executed = self._exec_demo_from_code(
                code, registry, self._model_client, result.component_ids
            )
            self._demos[demo_id] = _RunningDemo(
                demo_id=demo_id,
                interceptor=executed.interceptor,
                code=code,
                component_ids=set(result.component_ids),
            )
            self._registry = as_dict()
            return {
                "demoId": demo_id,
                "status": "done",
                "message": (
                    f"demo 已生成并运行（demo 代码直接执行，"
                    f"{len(result.component_ids)} 个组件）"
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
            registry = self._rebuild_registry()
            summary = run_ablation_on_demo(
                self._make_demo_builder(demo.code, demo.component_ids, registry),
                variables,
                self._eval_cases,
                self._make_evaluator(),
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

    def _make_demo_builder(self, code: str, component_ids: set, registry: dict):
        """消融变体构建器：每个变体/用例从 demo 代码重新 exec 一次再注入。

        复用 generate_demo_from_code 同款执行路径（code_check 结果已缓存为
        component_ids），变体 = 代码 + 注入操作，不再用配方。
        """

        def build() -> _AblationDemo:
            executed = self._exec_demo_from_code(
                code, registry, self._model_client, component_ids
            )
            return _AblationDemo(executed, registry, self._model_client)

        return build

    def _make_evaluator(self):
        def evaluate(demo: _AblationDemo, case: dict) -> EvaluationResult:
            reply = demo.run(case["prompt"])
            expected = case.get("expected")
            score = 1.0 if (expected is None or reply == expected) else 0.0
            return EvaluationResult(score=score, telemetry=demo.records())

        return evaluate
