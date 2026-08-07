import json
from types import SimpleNamespace

from components.agent import Agent
from components.context import ContextWindow
from components.model import OpenAIModel, TokenUsage
from components.tools import Tool, ToolCaller
from telemetry.interceptor import TelemetryInterceptor


class FakeModel:
    def __init__(self, replies):
        self._replies = list(replies)
        self.calls = 0

    def generate(self, messages):
        index = min(self.calls, len(self._replies) - 1)
        self.calls += 1
        return self._replies[index]


class FakeClock:
    def __init__(self, step=0.25):
        self.now = 1000.0
        self.step = step

    def __call__(self):
        value = self.now
        self.now += self.step
        return value

    def advance(self, seconds):
        self.now += seconds


def make_response(reply, prompt=0, completion=0):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=reply))],
        usage=SimpleNamespace(
            prompt_tokens=prompt,
            completion_tokens=completion,
            total_tokens=prompt + completion,
        ),
    )


class FakeClient:
    def __init__(self, reply="hello", prompt=0, completion=0):
        self.reply = reply
        self.prompt = prompt
        self.completion = completion

    @property
    def chat(self):
        return SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        return make_response(self.reply, self.prompt, self.completion)


class _ReportingModel:
    def __init__(self):
        self.on_usage = None

    def generate(self, messages):
        self.on_usage(
            "model-openai",
            TokenUsage(prompt_tokens=5, completion_tokens=2, total_tokens=7),
        )
        return "hi"


class _MinimalContext:
    def __init__(self):
        self.messages = []

    def add_user_message(self, content):
        self.messages.append({"role": "user", "content": content})

    def add_assistant_message(self, content):
        self.messages.append({"role": "assistant", "content": content})

    def add_tool_message(self, content, tool_call_id=None):
        message = {"role": "tool", "content": content}
        if tool_call_id is not None:
            message["tool_call_id"] = tool_call_id
        self.messages.append(message)

    def get_messages(self):
        return self.messages


class _MinimalTools:
    def call(self, request):
        return SimpleNamespace(success=True, output="ok", tool_call_id="c")


def make_add_tool():
    return Tool(name="add", func=lambda a, b: a + b)


def test_wrap_component_records_duration_and_call_count():
    clock = FakeClock()
    interceptor = TelemetryInterceptor(agent=object(), clock=clock)
    model = FakeModel(["hello"])
    interceptor.wrap_component("model-openai", model, "generate")

    model.generate([])

    assert interceptor.call_count("model-openai") == 1
    assert interceptor.call_counts == {"model-openai": 1}
    span = interceptor.spans[0]
    assert span.component_id == "model-openai"
    assert span.operation == "generate"
    assert span.start_time == 1000.0
    assert span.duration_ms == 250.0

    clock.advance(1.0)
    model.generate([])

    assert interceptor.call_count("model-openai") == 2
    assert interceptor.spans[-1].start_time == 1001.5
    assert interceptor.spans[-1].duration_ms == 250.0


def test_run_records_each_component_call_in_the_agent_loop():
    model = FakeModel(
        [json.dumps({"tool": "add", "arguments": {"a": 2, "b": 3}}), "the answer is 5"]
    )
    context = ContextWindow()
    tools = ToolCaller(tools=[make_add_tool()])
    agent = Agent(model=model, context=context, tools=tools)
    interceptor = TelemetryInterceptor(agent)
    interceptor.wrap_component("model-openai", model, "generate")
    interceptor.wrap_component("tool-caller", tools, "call")

    reply = interceptor.run("what is 2 + 3?")

    assert reply == "the answer is 5"
    assert interceptor.call_count("model-openai") == 2
    assert interceptor.call_count("tool-caller") == 1
    operations = [span.operation for span in interceptor.spans]
    assert operations.count("generate") == 2
    assert operations.count("call") == 1
    assert all(span.duration_ms >= 0 for span in interceptor.spans)


def test_collects_model_reported_token_usage():
    model = OpenAIModel(client=FakeClient(reply="hi", prompt=9, completion=3))
    agent = Agent(model=model, context=ContextWindow(), tools=ToolCaller(tools=[]))
    interceptor = TelemetryInterceptor(agent)
    interceptor.wrap_component("model-openai", model, "generate")

    interceptor.run("hi")

    spans = [span for span in interceptor.spans if span.operation == "generate"]
    assert len(spans) == 1
    assert spans[0].input_tokens == 9
    assert spans[0].output_tokens == 3
    assert spans[0].total_tokens == 12


def test_records_align_with_otel_genai_semconv():
    model = OpenAIModel(client=FakeClient(reply="hi", prompt=9, completion=3))
    agent = Agent(model=model, context=ContextWindow(), tools=ToolCaller(tools=[]))
    interceptor = TelemetryInterceptor(agent)
    interceptor.wrap_component("model-openai", model, "generate")

    interceptor.run("hi")

    records = interceptor.records()
    record = next(r for r in records if r["gen_ai.operation.name"] == "generate")
    assert record["name"] == "model-openai.generate"
    assert record["component_id"] == "model-openai"
    assert record["gen_ai.operation.name"] == "generate"
    assert record["gen_ai.usage.input_tokens"] == 9
    assert record["gen_ai.usage.output_tokens"] == 3
    assert record["gen_ai.usage.total_tokens"] == 12
    assert "start_time" in record
    assert "duration_ms" in record
    assert json.dumps(records)


def test_forwards_token_usage_to_external_on_usage_hook():
    reported = []
    model = OpenAIModel(client=FakeClient(reply="hi", prompt=9, completion=3))
    agent = Agent(model=model, context=ContextWindow(), tools=ToolCaller(tools=[]))
    interceptor = TelemetryInterceptor(
        agent, on_usage=lambda cid, usage: reported.append((cid, usage))
    )
    interceptor.wrap_component("model-openai", model, "generate")

    interceptor.run("hi")

    assert reported == [
        ("model-openai", TokenUsage(prompt_tokens=9, completion_tokens=3, total_tokens=12))
    ]


def test_interceptor_leaves_component_classes_untouched():
    original_run = Agent.run
    original_generate = OpenAIModel.generate
    original_call = ToolCaller.call

    model = OpenAIModel(client=FakeClient(reply="hi"))
    tools = ToolCaller(tools=[])
    agent = Agent(model=model, context=ContextWindow(), tools=tools)
    interceptor = TelemetryInterceptor(agent)
    interceptor.wrap_component("model-openai", model, "generate")
    interceptor.wrap_component("tool-caller", tools, "call")

    assert Agent.run is original_run
    assert OpenAIModel.generate is original_generate
    assert ToolCaller.call is original_call


def test_telemetry_works_with_duck_typed_components_and_no_backend():
    model = _ReportingModel()
    agent = Agent(model=model, context=_MinimalContext(), tools=_MinimalTools())
    interceptor = TelemetryInterceptor(agent)
    interceptor.wrap_component("model-openai", model, "generate")

    reply = interceptor.run("hi")

    assert reply == "hi"
    records = interceptor.records()
    generate_records = [r for r in records if r["gen_ai.operation.name"] == "generate"]
    assert generate_records[0]["gen_ai.usage.input_tokens"] == 5
    assert generate_records[0]["gen_ai.usage.output_tokens"] == 2
    assert generate_records[0]["gen_ai.usage.total_tokens"] == 7
    assert json.dumps(records)


def test_unwrap_restores_original_methods_and_on_usage():
    model = OpenAIModel(client=FakeClient(reply="hi"), on_usage=lambda *_: None)
    interceptor = TelemetryInterceptor(model)
    original_on_usage = model.on_usage

    interceptor.wrap_component("model-openai", model, "generate")
    assert model.generate.__name__ == "wrapped"
    assert model.on_usage.__self__ is interceptor

    interceptor.unwrap_all()
    assert model.generate.__name__ == "generate"
    assert model.on_usage is original_on_usage


def test_token_usage_attaches_to_matching_component_span():
    model = _ReportingModel()
    agent = Agent(model=model, context=_MinimalContext(), tools=_MinimalTools())
    interceptor = TelemetryInterceptor(agent)
    interceptor.wrap_component("model-openai", model, "generate")

    interceptor.run("hi")

    records = interceptor.records()
    generate_records = [r for r in records if r["gen_ai.operation.name"] == "generate"]
    assert generate_records[0]["gen_ai.usage.input_tokens"] == 5
    run_records = [r for r in records if r["gen_ai.operation.name"] == "run"]
    assert "gen_ai.usage.input_tokens" not in run_records[0]
