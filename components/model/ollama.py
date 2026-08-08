from openai import OpenAI

from components.model import (
    ModelReply,
    _extract_reply,
    _report_usage,
)
from components.registry import register
from components.types import ComponentSpec, ParamSpec, Port

OLLAMA_MODEL_SPEC = ComponentSpec(
    id="model-ollama",
    version="1.0",
    description="本地 Ollama 大模型封装组件：OpenAI 兼容 client 指向本地服务，支持原生工具调用与 token 上报。",
    role="model",
    class_name="OllamaModel",
    inputs=[Port(name="messages", type="MessageList")],
    outputs=[Port(name="response", type="string")],
    params={
        "model": ParamSpec(type="string", default="llama3"),
        "temperature": ParamSpec(type="number", min=0.0, max=2.0, default=0.7),
        "max_tokens": ParamSpec(type="number", min=1, max=16384, default=1024),
        "base_url": ParamSpec(type="string", default="http://localhost:11434/v1"),
    },
)


def register_ollama_model() -> ComponentSpec:
    register(OLLAMA_MODEL_SPEC)
    return OLLAMA_MODEL_SPEC


class OllamaModel:
    def __init__(
        self,
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        base_url: str | None = None,
        client=None,
        on_usage=None,
    ):
        self.model = model if model is not None else OLLAMA_MODEL_SPEC.params["model"].default
        self.temperature = (
            temperature
            if temperature is not None
            else OLLAMA_MODEL_SPEC.params["temperature"].default
        )
        self.max_tokens = (
            max_tokens if max_tokens is not None else OLLAMA_MODEL_SPEC.params["max_tokens"].default
        )
        self.base_url = (
            base_url if base_url is not None else OLLAMA_MODEL_SPEC.params["base_url"].default
        )
        self._validate_params()
        self._client = client if client is not None else self._default_client()
        self.on_usage = on_usage

    def _default_client(self):
        # Ollama 的 OpenAI 兼容端点接受任意非空 api_key
        return OpenAI(base_url=self.base_url, api_key="ollama")

    def _validate_params(self) -> None:
        for name in ("model", "temperature", "max_tokens"):
            spec = OLLAMA_MODEL_SPEC.params[name]
            spec.validate(getattr(self, name), component_id=OLLAMA_MODEL_SPEC.id, name=name)

    def set_param(self, name: str, value) -> None:
        """运行时参数覆盖（消融 ParameterOverride 用）：按契约校验后写入实例属性。"""
        if name not in ("model", "temperature", "max_tokens", "base_url"):
            raise ValueError(
                f"model-ollama 不支持运行时参数 {name!r}"
                "（仅 model/temperature/max_tokens/base_url）"
            )
        spec = OLLAMA_MODEL_SPEC.params[name]
        spec.validate(value, component_id=OLLAMA_MODEL_SPEC.id, name=name)
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
        _report_usage(OLLAMA_MODEL_SPEC.id, response, self.on_usage)
        return _extract_reply(response.choices[0].message)
