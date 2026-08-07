from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass
class Tool:
    name: str
    description: str = ""
    parameters: dict = field(default_factory=dict)
    func: Callable[..., Any] | None = None


@dataclass
class ToolCallRequest:
    tool_name: str
    arguments: dict = field(default_factory=dict)


@dataclass
class ToolCallResult:
    tool_name: str
    success: bool
    output: Any = None
    error: str | None = None

    def to_message(self) -> dict:
        if self.success:
            content = self.output if isinstance(self.output, str) else str(self.output)
        else:
            content = self.error or f"tool {self.tool_name!r} failed"
        return {"role": "tool", "tool": self.tool_name, "content": content}
