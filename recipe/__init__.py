from dataclasses import dataclass, field


@dataclass
class Recipe:
    name: str = "agent"
    components: list = field(default_factory=list)
    connections: list = field(default_factory=list)
    parameters: dict = field(default_factory=dict)


def validate(recipe: dict, known_component_ids: set[str] | None = None) -> Recipe:
    known = known_component_ids or set()

    components = recipe.get("components", [])
    component_ids = {c.get("id") for c in components if c.get("id")}
    for component in components:
        component_id = component.get("id")
        if component_id and known and component_id not in known:
            raise ValueError(f"unknown component: {component_id}")

    for connection in recipe.get("connections", []):
        for endpoint in (connection.get("from"), connection.get("to")):
            if endpoint and endpoint not in component_ids:
                raise ValueError(f"connection references missing component: {endpoint}")

    for component_id in recipe.get("parameters", {}):
        if component_id not in component_ids:
            raise ValueError(f"parameter for unknown component: {component_id}")

    return Recipe(
        name=recipe.get("name", "agent"),
        components=components,
        connections=recipe.get("connections", []),
        parameters=recipe.get("parameters", {}),
    )
