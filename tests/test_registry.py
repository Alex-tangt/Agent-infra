import pytest

from components import ComponentSpec, ParamSpec, Port, register, get_component, reset


@pytest.fixture(autouse=True)
def clean_registry():
    reset()
    yield
    reset()


def make_spec():
    return ComponentSpec(
        id="model-gpt4",
        version="1.0",
        inputs=[Port(name="messages", type="MessageList")],
        outputs=[Port(name="response", type="MessageList")],
        params={
            "temperature": ParamSpec(type="number", min=0.0, max=2.0, default=0.7),
        },
    )


def test_register_and_get_by_id_version():
    register(make_spec())

    spec = get_component("model-gpt4", "1.0")

    assert spec.id == "model-gpt4"
    assert spec.version == "1.0"
    assert [p.name for p in spec.inputs] == ["messages"]
    assert [p.name for p in spec.outputs] == ["response"]
    assert spec.params["temperature"].default == 0.7


def test_get_unknown_id_raises():
    with pytest.raises(KeyError, match="model-gpt4"):
        get_component("model-gpt4", "1.0")


def test_get_unknown_version_raises():
    register(make_spec())

    with pytest.raises(KeyError, match="9.9"):
        get_component("model-gpt4", "9.9")


def test_register_same_id_different_versions():
    register(make_spec())
    register(
        ComponentSpec(
            id="model-gpt4",
            version="2.0",
            inputs=[Port(name="messages", type="MessageList")],
            outputs=[Port(name="response", type="MessageList")],
            params={},
        )
    )

    assert get_component("model-gpt4", "1.0").version == "1.0"
    assert get_component("model-gpt4", "2.0").version == "2.0"


def test_duplicate_register_same_version_raises():
    register(make_spec())

    with pytest.raises(ValueError, match="already registered"):
        register(make_spec())
