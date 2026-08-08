import json
import os
from dataclasses import dataclass, field

from openai import OpenAI

from components.registry import register
from components.types import ComponentSpec, ParamSpec, Port


@dataclass(frozen=True)
class TokenUsage:
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


@dataclass(frozen=True)
class ToolCall:
    """LLM 发起的原生工具调用（OpenAI function calling 的结构化结果）"""

    id: str
    name: str
    arguments: dict


@dataclass(frozen=True)
class ModelReply:
    """模型生成结果：纯文本回复时 content 非空；请求工具时 tool_calls 非空"""

    content: str | None = None
    tool_calls: list[ToolCall] = field(default_factory=list)


MODEL_SPEC = ComponentSpec(
    id="model-openai",
    version="1.0",
    description="OpenAI 兼容大模型封装组件：接收消息列表，透传原生工具 schema，返回回复文本或结构化工具调用。",
    role="model",
    class_name="OpenAIModel",
    inputs=[Port(name="messages", type="MessageList")],
    outputs=[Port(name="response", type="string")],
    params={
        "model": ParamSpec(type="string", enum=["gpt-4o-mini", "gpt-4o", "deepseek-v4-flash", "deepseek-v4-pro"], default="gpt-4o-mini"),
        "temperature": ParamSpec(type="number", min=0.0, max=2.0, default=0.7),
        "max_tokens": ParamSpec(type="number", min=1, max=16384, default=1024),
    },
)


def register_model() -> ComponentSpec:
    register(MODEL_SPEC)
    return MODEL_SPEC


def _extract_reply(message) -> str | ModelReply:
    """把 OpenAI 兼容的响应 message 解析为回复文本或结构化工具调用"""
    raw_tool_calls = getattr(message, "tool_calls", None)
    if not raw_tool_calls:
        return message.content
    calls = []
    for call in raw_tool_calls:
        raw_arguments = getattr(call.function, "arguments", None) or "{}"
        try:
            arguments = json.loads(raw_arguments)
        except (json.JSONDecodeError, ValueError):
            arguments = {}
        if not isinstance(arguments, dict):
            arguments = {}
        calls.append(
            ToolCall(id=call.id, name=call.function.name, arguments=arguments)
        )
    return ModelReply(content=message.content, tool_calls=calls)


def _report_usage(model_id: str, response, on_usage) -> None:
    if on_usage is None:
        return
    raw = response.usage
    if raw is None:
        usage = TokenUsage(prompt_tokens=0, completion_tokens=0, total_tokens=0)
    else:
        usage = TokenUsage(
            prompt_tokens=raw.prompt_tokens,
            completion_tokens=raw.completion_tokens,
            total_tokens=raw.total_tokens,
        )
    on_usage(model_id, usage)


class OpenAIModel:
    def __init__(
        self,
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        client=None,
        on_usage=None,
    ):
        self.model = model if model is not None else MODEL_SPEC.params["model"].default
        self.temperature = (
            temperature
            if temperature is not None
            else MODEL_SPEC.params["temperature"].default
        )
        self.max_tokens = (
            max_tokens if max_tokens is not None else MODEL_SPEC.params["max_tokens"].default
        )
        self._validate_params()
        self._client = client if client is not None else self._default_client()
        self.on_usage = on_usage

    @staticmethod
    def _default_client():
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise ValueError(
                "OPENAI_API_KEY environment variable is required to call the real model"
            )
        return OpenAI(api_key=api_key)

    def _validate_params(self) -> None:
        for name in ("model", "temperature", "max_tokens"):
            spec = MODEL_SPEC.params[name]
            spec.validate(getattr(self, name), component_id=MODEL_SPEC.id, name=name)

    def set_param(self, name: str, value) -> None:
        """运行时参数覆盖（消融 ParameterOverride 用）：按契约校验后写入实例属性。"""
        if name not in ("model", "temperature", "max_tokens"):
            raise ValueError(
                f"model-openai 不支持运行时参数 {name!r}（仅 model/temperature/max_tokens）"
            )
        spec = MODEL_SPEC.params[name]
        spec.validate(value, component_id=MODEL_SPEC.id, name=name)
        setattr(self, name, value)

    def generate(self, messages: list[dict], tools: list[dict] | None = None) -> str | ModelReply:
        kwargs = dict(
            model=self.model,
            messages=messages,
            temperature=self.temperature,
            max_tokens=self.max_tokens,
        )
        if tools:
            kwargs["tools"] = tools
        response = self._client.chat.completions.create(**kwargs)
        _report_usage(MODEL_SPEC.id, response, self.on_usage)
        return _extract_reply(response.choices[0].message)


from components.model.ollama import (  # noqa: E402
    OLLAMA_MODEL_SPEC,
    OllamaModel,
    register_ollama_model,
)

__all__ = [
    "MODEL_SPEC",
    "OLLAMA_MODEL_SPEC",
    "ModelReply",
    "OllamaModel",
    "OpenAIModel",
    "TokenUsage",
    "ToolCall",
    "register_model",
    "register_ollama_model",
]
