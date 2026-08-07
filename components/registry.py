from components.types import ComponentSpec

_registry: dict[tuple[str, str], ComponentSpec] = {}


def reset() -> None:
    _registry.clear()


def register(spec: ComponentSpec) -> None:
    key = (spec.id, spec.version)
    if key in _registry:
        raise ValueError(f"component {spec.id}@{spec.version} already registered")
    _registry[key] = spec


def get(component_id: str, version: str) -> ComponentSpec:
    key = (component_id, version)
    if key not in _registry:
        raise KeyError(f"component {component_id}@{version} not found in registry")
    return _registry[key]


def snapshot() -> dict[str, ComponentSpec]:
    return {f"{cid}@{version}": spec for (cid, version), spec in _registry.items()}
