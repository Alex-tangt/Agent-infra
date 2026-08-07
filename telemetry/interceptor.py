import time
from collections import defaultdict
from dataclasses import dataclass

from components.agent import AGENT_SPEC


@dataclass
class TelemetrySpan:
    component_id: str
    operation: str
    start_time: float
    duration_ms: float
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None

    def to_record(self) -> dict:
        record = {
            "name": f"{self.component_id}.{self.operation}",
            "component_id": self.component_id,
            "gen_ai.operation.name": self.operation,
            "start_time": self.start_time,
            "duration_ms": self.duration_ms,
        }
        if self.input_tokens is not None:
            record["gen_ai.usage.input_tokens"] = self.input_tokens
            record["gen_ai.usage.output_tokens"] = self.output_tokens
            record["gen_ai.usage.total_tokens"] = self.total_tokens
        return record


class TelemetryInterceptor:
    def __init__(self, agent, *, on_usage=None, clock=time.time):
        self._agent = agent
        self._external_on_usage = on_usage
        self._clock = clock
        self._spans: list[TelemetrySpan] = []
        self._stack: list[TelemetrySpan] = []
        self._call_counts: dict[str, int] = defaultdict(int)

    def wrap_component(self, component_id: str, component, call_name: str):
        original = getattr(component, call_name)
        interceptor = self

        def wrapped(*args, **kwargs):
            return interceptor._observe_call(
                component_id, call_name, original, args, kwargs
            )

        setattr(component, call_name, wrapped)
        if hasattr(component, "on_usage"):
            component.on_usage = self.on_usage
        return wrapped

    def on_usage(self, component_id, usage) -> None:
        span = self._stack[-1] if self._stack else None
        if span is not None:
            span.input_tokens = usage.prompt_tokens
            span.output_tokens = usage.completion_tokens
            span.total_tokens = usage.total_tokens
        if self._external_on_usage is not None:
            self._external_on_usage(component_id, usage)

    def run(self, user_message: str) -> str:
        span = self._begin(AGENT_SPEC.id, "run")
        try:
            return self._agent.run(user_message)
        finally:
            self._end(span)

    @property
    def spans(self) -> list[TelemetrySpan]:
        return list(self._spans)

    def records(self) -> list[dict]:
        return [span.to_record() for span in self._spans]

    @property
    def call_counts(self) -> dict[str, int]:
        return dict(self._call_counts)

    def call_count(self, component_id: str) -> int:
        return self._call_counts[component_id]

    def _observe_call(self, component_id, call_name, original, args, kwargs):
        span = self._begin(component_id, call_name)
        try:
            return original(*args, **kwargs)
        finally:
            self._end(span)

    def _begin(self, component_id: str, operation: str) -> TelemetrySpan:
        span = TelemetrySpan(
            component_id=component_id,
            operation=operation,
            start_time=self._clock(),
            duration_ms=0.0,
        )
        self._spans.append(span)
        self._stack.append(span)
        self._call_counts[component_id] += 1
        return span

    def _end(self, span: TelemetrySpan) -> None:
        span.duration_ms = (self._clock() - span.start_time) * 1000.0
        self._stack.pop()
