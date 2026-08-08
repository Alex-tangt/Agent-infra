# 极简 agent demo：三件套 + 薄容器，代码即真相源（ADR-0005 验证样本）
# 组装器（coding agent）直接产出的 demo 形态：编排自由、组件接触面显式。

from components.agent import Agent, register_agent
from components.context import ContextWindow, register_context
from components.model import OpenAIModel, register_model
from components.tools import Tool, ToolCaller, register_tool_caller

register_context()
register_model()
register_tool_caller()
register_agent()


def add(a: float, b: float) -> float:
    return a + b


context_window = ContextWindow(max_rounds=5, strategy="truncate")
model_openai = OpenAIModel(model="gpt-4o-mini", temperature=0.7, max_tokens=1024)
tool_caller = ToolCaller(
    tools=[
        Tool(
            name="add",
            description="sum of two numbers",
            parameters={"type": "object", "properties": {"a": {"type": "number"}, "b": {"type": "number"}}},
            func=add,
        )
    ],
    strategy="strict",
)
agent_single = Agent(
    model=model_openai,
    context=context_window,
    tools=tool_caller,
    max_iterations=3,
)


def run(user_message: str) -> str:
    return agent_single.run(user_message)
