import json
from dataclasses import dataclass, field
from uuid import uuid4

from components.model import ModelReply, ToolCall
from components.registry import register
from components.types import ComponentSpec, ParamSpec, Port

AGENT_SPEC = ComponentSpec(
    id="agent-single",
    version="1.0",
    description="单体 agent 薄容器组件：编排模型、上下文与工具执行器，负责工具循环与停止条件。",
    role="agent",
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
