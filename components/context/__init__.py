from components.registry import register
from components.types import ComponentSpec, ParamSpec, Port


class ContextWindow:
    def __init__(self, max_rounds: int = 5, strategy: str = "truncate") -> None:
        if not isinstance(max_rounds, int) or isinstance(max_rounds, bool) or max_rounds < 1:
            raise ValueError(f"max_rounds must be an integer >= 1, got {max_rounds!r}")
        if strategy not in ("truncate",):
            raise ValueError(f"unsupported strategy: {strategy!r}")
        self._max_rounds = max_rounds
        self._strategy = strategy
        self._messages: list[dict] = []

    def add_user_message(self, content: str) -> None:
        self._messages.append({"role": "user", "content": content})
        self._truncate()

    def add_assistant_message(self, content: str) -> None:
        self._messages.append({"role": "assistant", "content": content})

    def add_tool_message(self, content: str, tool_call_id: str | None = None) -> None:
        message = {"role": "tool", "content": content}
        if tool_call_id is not None:
            message["tool_call_id"] = tool_call_id
        self._messages.append(message)

    def get_messages(self) -> list[dict]:
        return list(self._messages)

    def _truncate(self) -> None:
        while sum(1 for m in self._messages if m["role"] == "user") > self._max_rounds:
            self._drop_earliest_round()

    def _drop_earliest_round(self) -> None:
        for index, message in enumerate(self._messages):
            if message["role"] != "user":
                continue
            del self._messages[index]
            if index < len(self._messages) and self._messages[index]["role"] == "assistant":
                del self._messages[index]
            return


SPEC = ComponentSpec(
    id="context-window",
    version="1.0",
    inputs=[Port(name="user_message", type="string")],
    outputs=[Port(name="messages", type="MessageList")],
    params={
        "max_rounds": ParamSpec(type="integer", min=1, default=5),
        "strategy": ParamSpec(
            type="string",
            enum=["truncate"],
            default="truncate",
        ),
    },
)


def register_context() -> ComponentSpec:
    register(SPEC)
    return SPEC
