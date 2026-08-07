from dataclasses import dataclass
import os

from openai import OpenAI

from components.registry import register
from components.types import ComponentSpec, ParamSpec, Port


@dataclass(frozen=True)
class TokenUsage:
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


MODEL_SPEC = ComponentSpec(
    id="model-openai",
    version="1.0",
    inputs=[Port(name="messages", type="MessageList")],
    outputs=[Port(name="response", type="MessageList")],
    params={
        "model": ParamSpec(type="string", enum=["gpt-4o-mini", "gpt-4o"], default="gpt-4o-mini"),
        "temperature": ParamSpec(type="number", min=0.0, max=2.0, default=0.7),
        "max_tokens": ParamSpec(type="number", min=1, max=16384, default=1024),
    },
)


def register_component() -> ComponentSpec:
    register(MODEL_SPEC)
    return MODEL_SPEC


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
        model_spec = MODEL_SPEC.params["model"]
        if self.model not in model_spec.enum:
            raise ValueError(f"unknown model {self.model!r}; choose from {model_spec.enum}")

        temperature_spec = MODEL_SPEC.params["temperature"]
        if self.temperature < temperature_spec.min or self.temperature > temperature_spec.max:
            raise ValueError(
                f"temperature must be within [{temperature_spec.min}, {temperature_spec.max}], "
                f"got {self.temperature}"
            )

        max_tokens_spec = MODEL_SPEC.params["max_tokens"]
        if self.max_tokens < max_tokens_spec.min or self.max_tokens > max_tokens_spec.max:
            raise ValueError(
                f"max_tokens must be within [{max_tokens_spec.min}, {max_tokens_spec.max}], "
                f"got {self.max_tokens}"
            )

    def generate(self, messages: list[dict]) -> str:
        response = self._client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=self.temperature,
            max_tokens=self.max_tokens,
        )
        self._report_usage(response)
        return response.choices[0].message.content

    def _report_usage(self, response) -> None:
        if self.on_usage is None:
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
        self.on_usage(MODEL_SPEC.id, usage)
