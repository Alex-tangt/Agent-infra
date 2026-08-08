from components.registry import register
from components.types import ComponentSpec, ParamSpec, Port


class ContextWindow:
    def __init__(
        self,
        max_rounds: int = 5,
        strategy: str = "truncate",
        system_prompt: str | None = None,
    ) -> None:
        if not isinstance(max_rounds, int) or isinstance(max_rounds, bool) or max_rounds < 1:
            raise ValueError(f"max_rounds must be an integer >= 1, got {max_rounds!r}")
        if strategy not in ("truncate",):
            raise ValueError(f"unsupported strategy: {strategy!r}")
        self._max_rounds = max_rounds
        self._strategy = strategy
        self._system_prompt = system_prompt
        self._messages: list[dict] = []

    def add_user_message(self, content: str) -> None:
        self._messages.append({"role": "user", "content": content})
        self._truncate()

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
        messages = list(self._messages)
        if self._system_prompt:
            messages.insert(0, {"role": "system", "content": self._system_prompt})
        return messages

    def set_param(self, name: str, value) -> None:
        """运行时参数覆盖（消融 ParameterOverride 用）。

        max_rounds/strategy 走契约校验；system_prompt 是构造参数非契约参数，
        单独按类型校验（None 表示不注入 system prompt）。
        """
        if name in ("max_rounds", "strategy"):
            spec = SPEC.params[name]
            spec.validate(value, component_id=SPEC.id, name=name)
            setattr(self, f"_{name}", value)
            return
        if name == "system_prompt":
            if value is not None and not isinstance(value, str):
                raise ValueError(
                    f"system_prompt must be a string or None, got {value!r}"
                )
            self._system_prompt = value
            return
        raise ValueError(
            f"context-window 不支持运行时参数 {name!r}"
            "（仅 max_rounds/strategy/system_prompt）"
        )

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
    description="上下文窗口组件：维护对话消息列表，支持轮次截断与 system prompt 注入。",
    role="context",
    class_name="ContextWindow",
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
