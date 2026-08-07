import json

from recipe.schema import RECIPE_SCHEMA, to_json_schema


def test_recipe_schema_artifact_matches_python_single_source():
    with open("contracts/recipe-schema.json", encoding="utf-8") as handle:
        artifact = json.load(handle)

    assert artifact == RECIPE_SCHEMA


def test_recipe_schema_artifact_matches_to_json_schema_output():
    with open("contracts/recipe-schema.json", encoding="utf-8") as handle:
        artifact = handle.read()

    assert json.loads(artifact) == json.loads(to_json_schema())
