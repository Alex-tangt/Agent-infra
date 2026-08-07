import pytest

from recipe import validate


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

    result = validate(recipe)

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
        validate(recipe, known_component_ids={"model-gpt4", "tool-caller"})


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
        validate(recipe)


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
        validate(recipe)
