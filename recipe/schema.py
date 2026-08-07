import json

from recipe import Recipe

RECIPE_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "Agent Infra Recipe",
    "description": (
        "Language-neutral recipe contract shared between the assembler (TS) "
        "and the wiring engine (Python)."
    ),
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "components": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["id", "version"],
                "additionalProperties": False,
                "properties": {
                    "id": {"type": "string"},
                    "version": {"type": "string"},
                },
            },
        },
        "connections": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["from", "to"],
                "additionalProperties": False,
                "properties": {
                    "from": {"type": "string"},
                    "to": {"type": "string"},
                },
            },
        },
        "parameters": {
            "type": "object",
            "additionalProperties": {
                "type": "object",
                "additionalProperties": True,
            },
        },
    },
    "required": ["components", "connections", "parameters"],
    "additionalProperties": False,
}


def to_json_schema() -> str:
    return json.dumps(RECIPE_SCHEMA, indent=2)


def validate_json(text: str) -> Recipe:
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"recipe is not valid JSON: {exc}") from exc
    _validate_node(data, RECIPE_SCHEMA, "recipe")
    return Recipe(
        name=data.get("name", "agent"),
        components=data.get("components", []),
        connections=data.get("connections", []),
        parameters=data.get("parameters", {}),
    )


def _validate_node(value: object, schema: dict, path: str) -> None:
    kind = schema.get("type")
    if kind == "object":
        if not isinstance(value, dict):
            raise ValueError(f"{path} must be an object, got {value!r}")
        properties = schema.get("properties", {})
        for name in schema.get("required", []):
            if name not in value:
                raise ValueError(f"{path} missing required property {name!r}")
        for key, item in value.items():
            if key in properties:
                _validate_node(item, properties[key], f"{path}.{key}")
            elif not schema.get("additionalProperties", True):
                raise ValueError(f"{path} has unexpected property {key!r}")
    elif kind == "array":
        if not isinstance(value, list):
            raise ValueError(f"{path} must be an array, got {value!r}")
        items = schema.get("items")
        if items is not None:
            for index, item in enumerate(value):
                _validate_node(item, items, f"{path}[{index}]")
    elif kind == "string":
        if not isinstance(value, str):
            raise ValueError(f"{path} must be a string, got {value!r}")
    elif kind == "integer":
        if not (isinstance(value, int) and not isinstance(value, bool)):
            raise ValueError(f"{path} must be an integer, got {value!r}")
    elif kind == "number":
        if not (isinstance(value, (int, float)) and not isinstance(value, bool)):
            raise ValueError(f"{path} must be a number, got {value!r}")
