from dataclasses import dataclass, field

from components.types import ComponentSpec, ParamSpec


@dataclass
class Recipe:
    name: str = "agent"
    components: list = field(default_factory=list)
    connections: list = field(default_factory=list)
    parameters: dict = field(default_factory=dict)


def validate(recipe: dict, registry: dict[tuple[str, str], ComponentSpec] | None = None) -> Recipe:
    if registry is None:
        raise ValueError("registry is required for recipe validation")

    components = recipe.get("components", [])
    component_ids = {c.get("id") for c in components if c.get("id")}
    for component in components:
        component_id = component.get("id")
        version = component.get("version")
        if not component_id or not version:
            raise ValueError(f"component must declare id and version: {component}")
        spec = registry.get((component_id, version))
        if spec is None:
            raise ValueError(
                f"unknown component: {component_id}@{version} not in registry"
            )

    for connection in recipe.get("connections", []):
        for endpoint in (connection.get("from"), connection.get("to")):
            if endpoint and endpoint not in component_ids:
                raise ValueError(f"connection references missing component: {endpoint}")

    for component_id, params in recipe.get("parameters", {}).items():
        if component_id not in component_ids:
            raise ValueError(f"parameter for unknown component: {component_id}")
        version = next(
            c["version"] for c in components if c.get("id") == component_id
        )
        spec = registry[(component_id, version)]
        for name, value in params.items():
            param_spec = spec.params.get(name)
            if param_spec is None:
                raise ValueError(f"unknown parameter {name!r} for component {component_id!r}")
            _validate_param(component_id, name, value, param_spec)

    return Recipe(
        name=recipe.get("name", "agent"),
        components=components,
        connections=recipe.get("connections", []),
        parameters=recipe.get("parameters", {}),
    )


def _validate_param(component_id: str, name: str, value: object, spec: ParamSpec) -> None:
    if spec.enum is not None and value not in spec.enum:
        raise ValueError(
            f"parameter {name!r} for component {component_id!r} must be one of {spec.enum}, got {value!r}"
        )
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if spec.min is not None and value < spec.min:
            raise ValueError(f"parameter {name!r} for component {component_id!r} below min {spec.min}")
        if spec.max is not None and value > spec.max:
            raise ValueError(f"parameter {name!r} for component {component_id!r} above max {spec.max}")
