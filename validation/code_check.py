"""AST 代码校验器：对组装器直接产出的 demo 代码做静态校验（ADR-0005 双层校验的下层）。

校验对象是最终 demo 代码（真相源），权威源是组件注册表 registry。
只校验"对已注册组件类的显式构造调用"（组件接触面），编排逻辑自由不校验。
参数校验分层：
- 字面量参数：类型 / 枚举 / 范围全量校验
- 变量/字典参数：仅校验参数名存在
- 动态拼接：仅确认是构造调用
"""

import ast
from dataclasses import dataclass, field

from components.types import ComponentSpec


@dataclass
class CodeCheckIssue:
    message: str
    lineno: int
    kind: str = "error"


@dataclass
class CodeCheckResult:
    issues: list[CodeCheckIssue] = field(default_factory=list)
    checked_calls: int = 0

    @property
    def ok(self) -> bool:
        return not self.issues


def _literal_or_none(node) -> object | None:
    """求字面量参数值；非字面量（变量/字典/表达式）返回 None 表示"仅参数名校验"。"""
    try:
        return ast.literal_eval(node)
    except (ValueError, TypeError, SyntaxError):
        return None


def check_demo_code(code: str, registry: dict[tuple[str, str], ComponentSpec]) -> CodeCheckResult:
    result = CodeCheckResult()
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        result.issues.append(
            CodeCheckIssue(message=f"demo 代码不是合法 Python: {exc}", lineno=getattr(exc, "lineno", 0))
        )
        return result

    spec_by_class = {}
    for (_cid, _version), spec in registry.items():
        spec_by_class[spec.class_name or _class_name_for(spec.id)] = spec

    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        spec = _match_constructor(node.func, spec_by_class)
        if spec is None:
            continue
        result.checked_calls += 1
        _check_call(node, spec, result)
    return result


def _class_name_for(component_id: str) -> str:
    # 组件类名约定：context-window -> ContextWindow；model-openai -> OpenAIModel；
    # tool-caller -> ToolCaller；agent-single -> Agent；model-ollama -> OllamaModel。
    # 以注册类名为准回退 id 的驼峰化。
    camel = "".join(part[:1].upper() + part[1:] for part in component_id.split("-"))
    return camel


def _match_constructor(node, spec_by_class: dict) -> ComponentSpec | None:
    if isinstance(node, ast.Name) and node.id in spec_by_class:
        return spec_by_class[node.id]
    if (
        isinstance(node, ast.Attribute)
        and isinstance(node.value, ast.Name)
        and node.value.id in ("components",)
        and node.attr in spec_by_class
    ):
        return spec_by_class[node.attr]
    return None


_AGENT_ROLE_PARAMS = {"model", "context", "tools"}
"""role=agent 组件的零件注入参数：值必须是已实例化的零件变量，不属参数契约。"""


def _check_call(node: ast.Call, spec: ComponentSpec, result: CodeCheckResult) -> None:
    param_specs = spec.params
    provided = {}
    if node.args:
        # 位置参数只能出现在 agent 的 model/context/tools 场景之外；组件构造均为关键字参数，
        # 位置参数直接判定为接口不符合（构造签名不可静态确认）。
        result.issues.append(
            CodeCheckIssue(
                message=f"组件 {spec.id!r} 构造调用使用位置参数，要求全部关键字参数",
                lineno=node.lineno,
            )
        )
        return
    for keyword in node.keywords:
        if keyword.arg is None:
            result.issues.append(
                CodeCheckIssue(
                    message=f"组件 {spec.id!r} 构造调用包含 **kwargs 动态参数，参数级校验失效",
                    lineno=keyword.lineno,
                )
            )
            continue
        provided[keyword.arg] = keyword.value

    for name, value_node in provided.items():
        if spec.role == "agent" and name in _AGENT_ROLE_PARAMS:
            # 零件注入：校验值是简单变量引用（已实例化的零件），不校验值本身
            if not (isinstance(value_node, ast.Name)):
                result.issues.append(
                    CodeCheckIssue(
                        message=f"agent 组件零件 {name!r} 必须是组件实例变量，got 非变量表达式",
                        lineno=value_node.lineno,
                    )
                )
            continue
        if name not in param_specs:
            result.issues.append(
                CodeCheckIssue(
                    message=f"组件 {spec.id!r} 参数 {name!r} 不在契约中（{sorted(param_specs)}）",
                    lineno=value_node.lineno,
                )
            )
            continue
        value = _literal_or_none(value_node)
        if value is None:
            continue
        try:
            param_specs[name].validate(value, component_id=spec.id, name=name)
        except ValueError as exc:
            result.issues.append(
                CodeCheckIssue(message=str(exc), lineno=value_node.lineno)
            )
