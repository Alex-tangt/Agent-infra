import json

import pytest

from components import ComponentSpec, ParamSpec, Port
from recipe import validate
from recipe.schema import RECIPE_SCHEMA, to_json_schema, validate_json

REGISTRY = {
    ("model-gpt4", "1.0"): ComponentSpec(
        id="model-gpt4",
        version="1.0",
        inputs=[Port(name="messages", type="MessageList")],
        outputs=[Port(name="response", type="MessageList")],
        params={
            "temperature": ParamSpec(type="number", min=0.0, max=2.0, default=0.7),
            "model": ParamSpec(type="string", enum=["gpt-4", "gpt-4o"], default="gpt-4"),
        },
    ),
    ("context-window", "1.0"): ComponentSpec(id="context-window", version="1.0"),
}

VALID_RECIPE = {
    "name": "weather-agent",
    "components": [
        {"id": "model-gpt4", "version": "1.0"},
        {"id": "context-window", "version": "1.0"},
    ],
    "connections": [
        {"from": "model-gpt4", "to": "context-window"},
    ],
    "parameters": {
        "model-gpt4": {"temperature": 0.7},
    },
}


def _schema() -> dict:
    return json.loads(to_json_schema())


# --- AC1: assembler can read the schema (three structure types) ---


def test_to_json_schema_returns_parseable_schema_document():
    schema = _schema()
    assert schema["$schema"].startswith("https://json-schema.org/draft/")
    assert schema["type"] == "object"


def test_schema_describes_component_references():
    items = _schema()["properties"]["components"]["items"]
    assert items["type"] == "object"
    assert set(items["required"]) == {"id", "version"}
    assert items["properties"]["id"]["type"] == "string"
    assert items["properties"]["version"]["type"] == "string"


def test_schema_describes_connections():
    items = _schema()["properties"]["connections"]["items"]
    assert items["type"] == "object"
    assert set(items["required"]) == {"from", "to"}
    assert items["properties"]["from"]["type"] == "string"
    assert items["properties"]["to"]["type"] == "string"


def test_schema_describes_parameter_overrides():
    parameters = _schema()["properties"]["parameters"]
    assert parameters["type"] == "object"
    assert parameters["additionalProperties"]["type"] == "object"


# --- AC2: self-validation before producing the recipe ---


def test_validate_json_accepts_full_valid_recipe():
    result = validate_json(json.dumps(VALID_RECIPE))

    assert result.name == "weather-agent"
    assert result.components == VALID_RECIPE["components"]
    assert result.connections == VALID_RECIPE["connections"]
    assert result.parameters == {"model-gpt4": {"temperature": 0.7}}


def test_validate_json_defaults_name_when_missing():
    minimal = {k: v for k, v in VALID_RECIPE.items() if k != "name"}

    result = validate_json(json.dumps(minimal))

    assert result.name == "agent"


# --- AC3: invalid recipes rejected at the assembler side ---


def test_validate_json_rejects_non_json_text():
    with pytest.raises(ValueError, match="not valid JSON"):
        validate_json("{ this is not json")


def test_validate_json_rejects_non_object_json():
    with pytest.raises(ValueError, match="must be an object"):
        validate_json('[{"id": "model-gpt4"}]')


def test_validate_json_rejects_missing_components():
    recipe = {k: v for k, v in VALID_RECIPE.items() if k != "components"}

    with pytest.raises(ValueError, match="components"):
        validate_json(json.dumps(recipe))


def test_validate_json_rejects_component_without_version():
    recipe = dict(VALID_RECIPE)
    recipe["components"] = [{"id": "model-gpt4"}]

    with pytest.raises(ValueError, match="version"):
        validate_json(json.dumps(recipe))


def test_validate_json_rejects_component_without_id():
    recipe = dict(VALID_RECIPE)
    recipe["components"] = [{"version": "1.0"}]

    with pytest.raises(ValueError, match="'id'"):
        validate_json(json.dumps(recipe))


def test_validate_json_rejects_connection_without_to():
    recipe = dict(VALID_RECIPE)
    recipe["connections"] = [{"from": "model-gpt4"}]

    with pytest.raises(ValueError, match="'to'"):
        validate_json(json.dumps(recipe))


def test_validate_json_rejects_unknown_top_level_field():
    recipe = dict(VALID_RECIPE)
    recipe["spurious"] = True

    with pytest.raises(ValueError, match="spurious"):
        validate_json(json.dumps(recipe))


def test_validate_json_rejects_non_object_parameters():
    recipe = dict(VALID_RECIPE)
    recipe["parameters"] = ["model-gpt4"]

    with pytest.raises(ValueError, match="parameters"):
        validate_json(json.dumps(recipe))


# --- AC4: schema shared with Python side (language-neutral single source) ---


def test_to_json_schema_matches_single_source_constant():
    assert json.loads(to_json_schema()) == RECIPE_SCHEMA


def test_schema_contract_agrees_with_python_validate():
    recipe = validate_json(json.dumps(VALID_RECIPE))
    payload = {
        "name": recipe.name,
        "components": recipe.components,
        "connections": recipe.connections,
        "parameters": recipe.parameters,
    }

    validated = validate(payload, registry=REGISTRY)

    assert validated.name == "weather-agent"
