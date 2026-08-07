from components.tools.tool import Tool, ToolCallRequest, ToolCallResult


class ToolCaller:
    def __init__(self, tools: list[Tool] | None = None, strategy: str = "strict"):
        self._tools = {tool.name: tool for tool in (tools or [])}
        self.strategy = strategy

    def available_tools(self) -> list[Tool]:
        return list(self._tools.values())

    def call(self, request: ToolCallRequest) -> ToolCallResult:
        tool = self._tools.get(request.tool_name)
        if tool is None or tool.func is None:
            message = f"tool {request.tool_name!r} is not declared"
            if self.strategy == "strict":
                raise ValueError(message)
            return ToolCallResult(tool_name=request.tool_name, success=False, error=message)
        output = tool.func(**request.arguments)
        return ToolCallResult(tool_name=request.tool_name, success=True, output=output)
