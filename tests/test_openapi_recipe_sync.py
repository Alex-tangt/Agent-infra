import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def _load_openapi_recipe_schema():
    with (REPO_ROOT / "contracts" / "demo-api.openapi.json").open(encoding="utf-8") as f:
        openapi = json.load(f)
    return openapi["components"]["schemas"]["Recipe"]


def _load_recipe_schema():
    with (REPO_ROOT / "contracts" / "recipe-schema.json").open(encoding="utf-8") as f:
        return json.load(f)


def test_openapi_recipe_matches_single_source_recipe_schema():
    openapi_recipe = _load_openapi_recipe_schema()
    recipe_schema = _load_recipe_schema()

    assert openapi_recipe["type"] == recipe_schema["type"] == "object"
    assert openapi_recipe["additionalProperties"] == recipe_schema["additionalProperties"]
    assert sorted(openapi_recipe["required"]) == sorted(recipe_schema["required"])
    assert sorted(openapi_recipe["properties"]) == sorted(recipe_schema["properties"])

    def required_shape(properties, key):
        return sorted(properties[key].get("required", []))

    for key in ("components", "connections"):
        assert required_shape(openapi_recipe["properties"], key) == required_shape(
            recipe_schema["properties"], key
        )
