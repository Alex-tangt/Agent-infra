import json
from dataclasses import dataclass, field
from uuid import uuid4

from components.model import ModelReply, ToolCall
from components.registry import register
from components.tools.tool import ToolCallResult
from components.types import ComponentSpec, ParamSpec, Port

AGENT_SPEC = ComponentSpec(
    id="agent-single",
    version="1.0",
    description="单体 agent 薄容器组件：编排模型、上下文与工具执行器，负责工具循环与停止条件。",
    role="agent",
    class_name="Agent",
    inputs=[Port(name="user_message", type="string")],
    outputs=[Port(name="reply", type="string")],
    params={
        "max_iterations": ParamSpec(type="integer", min=1, default=5),
    },
)


def register_agent() -> ComponentSpec:
    register(AGENT_SPEC)
    return AGENT_SPEC


@dataclass
class ToolRequest:
    tool_name: str
    arguments: dict
    tool_call_id: str = field(default_factory=lambda: f"call_{uuid4().hex[:8]}")


def default_turn_strategy(text: str) -> ToolRequest | None:
    """兼容旧版文本 JSON 模拟：从模型纯文本输出中解析工具请求（已不是默认路径）"""
    stripped = text.strip()
    if not (stripped.startswith("{") and stripped.endswith("}")):
        return None
    try:
        payload = json.loads(stripped)
    except (json.JSONDecodeError, ValueError):
        return None
    tool_name = payload.get("tool")
    arguments = payload.get("arguments", {})
    if not isinstance(tool_name, str) or not tool_name:
        return None
    if not isinstance(arguments, dict):
        arguments = {}
    return ToolRequest(tool_name=tool_name, arguments=arguments)


def build_tool_schemas(tools) -> list[dict]:
    """把配方的工具参数（name/description/parameters）转成 OpenAI function calling 格式"""
    schemas = []
    for tool in tools:
        parameters = tool.parameters or {"type": "object", "properties": {}}
        schemas.append(
            {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description or "",
                    "parameters": parameters,
                },
            }
        )
    return schemas


def _assistant_tool_calls_payload(tool_calls: list[ToolCall]) -> list[dict]:
    """把结构化 ToolCall 转回 OpenAI 消息格式的 tool_calls 载荷（回填上下文用）"""
    return [
        {
            "id": call.id,
            "type": "function",
            "function": {
                "name": call.name,
                "arguments": json.dumps(call.arguments),
            },
        }
        for call in tool_calls
    ]


_AGENT_PART_ROLES = ("model", "context", "tools")
"""agent 零件角色白名单：运行时注入协议（ADR-0005 第 7 条）只认这三个 role。"""


class _DisabledModel:
    """运行时 disable 的模型零件：不再产生任何模型调用（消融 ComponentRemove 用）"""

    def generate(self, messages, tools=None):
        return ""


class _DisabledContext:
    """运行时 disable 的上下文零件：只记录消息，不做截断与 system prompt 注入"""

    def __init__(self):
        self._messages: list[dict] = []

    def add_user_message(self, content: str) -> None:
        self._messages.append({"role": "user", "content": content})

    def add_assistant_message(
        self, content: str, tool_calls: list[dict] | None = None
    ) -> None:
        message = {"role": "assistant", "content": content}
        if tool_calls:
            message["tool_calls"] = tool_calls
        self._messages.append(message)

    def add_tool_message(self, content: str, tool_call_id: str | None = None) -> None:
        message = {"role": "tool", "content": content}
        if tool_call_id is not None:
            message["tool_call_id"] = tool_call_id
        self._messages.append(message)

    def get_messages(self) -> list[dict]:
        return list(self._messages)


class _DisabledTools:
    """运行时 disable 的工具零件：无可用工具，调用统一返回失败（消融 ComponentRemove 用）"""

    def available_tools(self):
        return []

    def call(self, request) -> "ToolCallResult":
        return ToolCallResult(
            tool_name=getattr(request, "tool_name", ""),
            success=False,
            error="tool disabled",
            tool_call_id=getattr(request, "tool_call_id", None),
        )


class Agent:
    def __init__(
        self,
        model,
        context,
        tools,
        *,
        turn_strategy=None,
        max_iterations: int = 5,
    ):
        if (
            not isinstance(max_iterations, int)
            or isinstance(max_iterations, bool)
            or max_iterations < 1
        ):
            raise ValueError(
                f"max_iterations must be an integer >= 1, got {max_iterations!r}"
            )
        self._model = model
        self._context = context
        self._tools = tools
        self._turn_strategy = turn_strategy
        self._max_iterations = max_iterations

    # --- 注入协议（ADR-0005 第 7 条）：消融等运行时机械调用，构造仍强制三件套 ---

    def set_param(self, name: str, value) -> None:
        """运行时参数覆盖：目前仅支持 max_iterations，其余参数抛 ValueError。"""
        if name == "max_iterations":
            if (
                not isinstance(value, int)
                or isinstance(value, bool)
                or value < 1
            ):
                raise ValueError(
                    f"max_iterations must be an integer >= 1, got {value!r}"
                )
            self._max_iterations = value
            return
        raise ValueError(
            f"agent-single 不支持运行时参数 {name!r}（仅 max_iterations）"
        )

    def replace_part(self, role: str, instance) -> None:
        """运行时替换零件（model/context/tools 之一），用于 ComponentSwap 消融。"""
        if role not in _AGENT_PART_ROLES:
            raise ValueError(
                f"agent 零件 role 必须是 model/context/tools 之一，got {role!r}"
            )
        setattr(self, f"_{role}", instance)

    def disable_part(self, role: str) -> None:
        """运行时移除零件效果（model/context/tools 之一），用于 ComponentRemove 消融。

        接受空零件：构造仍强制三件套，disable 是运行期行为，把对应零件换成
        不报错的占位实现，agent 循环照常走通。
        """
        if role not in _AGENT_PART_ROLES:
            raise ValueError(
                f"agent 零件 role 必须是 model/context/tools 之一，got {role!r}"
            )
        if role == "model":
            self._model = _DisabledModel()
        elif role == "context":
            self._context = _DisabledContext()
        else:
            self._tools = _DisabledTools()

    def run(self, user_message: str) -> str:
        self._context.add_user_message(user_message)
        reply_text = ""
        for _ in range(self._max_iterations):
            reply = self._model.generate(
                self._context.get_messages(),
                tools=build_tool_schemas(self._tools.available_tools()),
            )
            if isinstance(reply, ModelReply) and reply.tool_calls:
                # 原生工具调用：assistant 消息带 tool_calls 回填，逐个执行工具并回填结果
                self._context.add_assistant_message(
                    reply.content,
                    tool_calls=_assistant_tool_calls_payload(reply.tool_calls),
                )
                for call in reply.tool_calls:
                    request = ToolRequest(
                        tool_name=call.name,
                        arguments=call.arguments,
                        tool_call_id=call.id,
                    )
                    result = self._tools.call(request)
                    content = result.output if result.success else (result.error or f"tool failed")
                    self._context.add_tool_message(
                        str(content), tool_call_id=result.tool_call_id
                    )
                continue
            if isinstance(reply, ModelReply):
                reply_text = reply.content or ""
            else:
                reply_text = reply
            self._context.add_assistant_message(reply_text)
            if self._turn_strategy is not None:
                request = self._turn_strategy(reply_text)
                if request is not None:
                    result = self._tools.call(request)
                    content = result.output if result.success else (result.error or f"tool failed")
                    self._context.add_tool_message(
                        str(content), tool_call_id=result.tool_call_id
                    )
                    continue
            return reply_text
        return reply_text
