from components.registry import register
from components.types import ComponentSpec, ParamSpec, Port

COMPONENT_ID = "tool-caller"
COMPONENT_VERSION = "1.0"
VALID_STRATEGIES = ["strict", "lenient"]


def get_tool_caller_spec() -> ComponentSpec:
    return ComponentSpec(
        id=COMPONENT_ID,
        version=COMPONENT_VERSION,
        description="工具执行器组件：按工具名查表执行已声明工具，返回结构化执行结果。",
        role="tools",
        inputs=[Port(name="tool_call", type="ToolCallRequest")],
        outputs=[Port(name="result", type="ToolCallResult")],
        params={
            "tools": ParamSpec(type="list", default=[]),
            "strategy": ParamSpec(type="string", enum=VALID_STRATEGIES, default="strict"),
        },
    )


def register_tool_caller() -> None:
    register(get_tool_caller_spec())
