import json

from components.registry import register
from components.tools.tool import ToolCallRequest
from components.types import ComponentSpec, ParamSpec, Port

AGENT_SPEC = ComponentSpec(
    id="agent-single",
    version="1.0",
    inputs=[Port(name="user_message", type="string")],
    outputs=[Port(name="reply", type="string")],
    params={
        "max_iterations": ParamSpec(type="integer", min=1, default=5),
    },
)


def register_agent() -> ComponentSpec:
    register(AGENT_SPEC)
    return AGENT_SPEC


def default_turn_strategy(text: str) -> ToolCallRequest | None:
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
    return ToolCallRequest(tool_name=tool_name, arguments=arguments)


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
        self._turn_strategy = turn_strategy if turn_strategy is not None else default_turn_strategy
        self._max_iterations = max_iterations

    def run(self, user_message: str) -> str:
        self._context.add_user_message(user_message)
        reply = ""
        for _ in range(self._max_iterations):
            reply = self._model.generate(self._context.get_messages())
            self._context.add_assistant_message(reply)
            request = self._turn_strategy(reply)
            if request is None:
                return reply
            result = self._tools.call(request)
            message = result.to_message()
            self._context.add_tool_message(
                message["content"], tool_call_id=message.get("tool_call_id")
            )
        return reply
