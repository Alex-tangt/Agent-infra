from components.tools.registration import VALID_STRATEGIES
from components.tools.tool import Tool, ToolCallResult


class ToolCaller:
    def __init__(self, tools: list[Tool] | None = None, strategy: str = "strict"):
        if strategy not in VALID_STRATEGIES:
            raise ValueError(f"unsupported strategy: {strategy!r}")
        self._tools = {tool.name: tool for tool in (tools or [])}
        self.strategy = strategy

    def set_param(self, name: str, value) -> None:
        """运行时参数覆盖（消融 ParameterOverride 用）：strategy 与 tools 可变。"""
        if name == "strategy":
            if value not in VALID_STRATEGIES:
                raise ValueError(f"unsupported strategy: {value!r}")
            self.strategy = value
            return
        if name == "tools":
            if value is None:
                value = []
            if not isinstance(value, list):
                raise ValueError(f"tools must be a list, got {value!r}")
            self._tools = {tool.name: tool for tool in value}
            return
        raise ValueError(
            f"tool-caller 不支持运行时参数 {name!r}（仅 strategy/tools）"
        )

    def available_tools(self) -> list[Tool]:
        return list(self._tools.values())

    def call(self, request) -> ToolCallResult:
        tool = self._tools.get(request.tool_name)
        call_id = getattr(request, "tool_call_id", None)
        if tool is None or tool.func is None:
            message = f"tool {request.tool_name!r} is not declared"
            if self.strategy == "strict":
                raise ValueError(message)
            return ToolCallResult(
                tool_name=request.tool_name,
                success=False,
                error=message,
                tool_call_id=call_id,
            )
        try:
            output = tool.func(**request.arguments)
        except Exception as exc:
            return ToolCallResult(
                tool_name=request.tool_name,
                success=False,
                error=f"{type(exc).__name__}: {exc}",
                tool_call_id=call_id,
            )
        return ToolCallResult(
            tool_name=request.tool_name,
            success=True,
            output=output,
            tool_call_id=call_id,
        )
