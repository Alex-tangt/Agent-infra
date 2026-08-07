from dataclasses import dataclass, field
from typing import Any, Callable
from uuid import uuid4


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
    tool_call_id: str = field(default_factory=lambda: f"call_{uuid4().hex[:8]}")


@dataclass
class ToolCallResult:
    tool_name: str
    success: bool
    output: Any = None
    error: str | None = None
    tool_call_id: str | None = None

    def to_message(self) -> dict:
        if self.success:
            content = self.output if isinstance(self.output, str) else str(self.output)
        else:
            content = self.error or f"tool {self.tool_name!r} failed"
        return {
            "role": "tool",
            "tool_call_id": self.tool_call_id,
            "content": content,
        }
