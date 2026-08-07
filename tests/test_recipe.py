import pytest

from components import ComponentSpec, ParamSpec
from recipe import validate

REGISTRY = {
    "model-gpt4": ComponentSpec(
        id="model-gpt4",
        version="1.0",
        params={
            "temperature": ParamSpec(type="number", min=0.0, max=2.0, default=0.7),
            "model": ParamSpec(type="string", enum=["gpt-4", "gpt-4o"], default="gpt-4"),
        },
    ),
    "context-window": ComponentSpec(id="context-window", version="1.0"),
    "tool-caller": ComponentSpec(
        id="tool-caller",
        version="1.0",
        params={"max_iterations": ParamSpec(type="number", min=1, max=10, default=3)},
    ),
}


def test_valid_recipe_returns_normalized_object():
    recipe = {
        "name": "weather-agent",
        "components": [
            {"id": "model-gpt4", "version": "1.0"},
            {"id": "context-window", "version": "1.0"},
            {"id": "tool-caller", "version": "1.0"},
        ],
        "connections": [
            {"from": "model-gpt4", "to": "context-window"},
        ],
        "parameters": {
            "model-gpt4": {"temperature": 0.7},
        },
    }

    result = validate(recipe, registry=REGISTRY)

    assert result.name == "weather-agent"
    assert result.components == [
        {"id": "model-gpt4", "version": "1.0"},
        {"id": "context-window", "version": "1.0"},
        {"id": "tool-caller", "version": "1.0"},
    ]
    assert result.parameters["model-gpt4"]["temperature"] == 0.7


def test_unknown_component_id_is_rejected():
    recipe = {
        "components": [
            {"id": "does-not-exist", "version": "1.0"},
        ],
        "connections": [],
        "parameters": {},
    }

    with pytest.raises(ValueError, match="unknown component"):
        validate(recipe, registry=REGISTRY)


def test_component_missing_version_is_rejected():
    recipe = {
        "components": [
            {"id": "model-gpt4"},
        ],
        "connections": [],
        "parameters": {},
    }

    with pytest.raises(ValueError, match="id and version"):
        validate(recipe, registry=REGISTRY)


def test_unknown_component_version_is_rejected():
    recipe = {
        "components": [
            {"id": "model-gpt4", "version": "9.9"},
        ],
        "connections": [],
        "parameters": {},
    }

    with pytest.raises(ValueError, match="unknown version"):
        validate(recipe, registry=REGISTRY)


def test_missing_registry_is_rejected():
    recipe = {
        "components": [],
        "connections": [],
        "parameters": {},
    }

    with pytest.raises(ValueError, match="registry is required"):
        validate(recipe)


def test_connection_referencing_missing_component_is_rejected():
    recipe = {
        "components": [
            {"id": "model-gpt4", "version": "1.0"},
        ],
        "connections": [
            {"from": "model-gpt4", "to": "ghost-component"},
        ],
        "parameters": {},
    }

    with pytest.raises(ValueError, match="connection"):
        validate(recipe, registry=REGISTRY)


def test_parameters_for_unknown_component_are_rejected():
    recipe = {
        "components": [
            {"id": "model-gpt4", "version": "1.0"},
        ],
        "connections": [],
        "parameters": {
            "ghost-component": {"temperature": 0.7},
        },
    }

    with pytest.raises(ValueError, match="parameter"):
        validate(recipe, registry=REGISTRY)


def test_unknown_parameter_name_is_rejected():
    recipe = {
        "components": [
            {"id": "model-gpt4", "version": "1.0"},
        ],
        "connections": [],
        "parameters": {
            "model-gpt4": {"temperature": 0.7, "fabricated_param": 1},
        },
    }

    with pytest.raises(ValueError, match="unknown parameter"):
        validate(recipe, registry=REGISTRY)


def test_parameter_outside_enum_is_rejected():
    recipe = {
        "components": [
            {"id": "model-gpt4", "version": "1.0"},
        ],
        "connections": [],
        "parameters": {
            "model-gpt4": {"model": "claude-3"},
        },
    }

    with pytest.raises(ValueError, match="must be one of"):
        validate(recipe, registry=REGISTRY)


def test_parameter_outside_range_is_rejected():
    recipe = {
        "components": [
            {"id": "model-gpt4", "version": "1.0"},
        ],
        "connections": [],
        "parameters": {
            "model-gpt4": {"temperature": 3.5},
        },
    }

    with pytest.raises(ValueError, match="above max"):
        validate(recipe, registry=REGISTRY)
