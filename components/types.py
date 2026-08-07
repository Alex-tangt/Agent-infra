from dataclasses import dataclass, field


@dataclass
class Port:
    name: str
    type: str


@dataclass
class ParamSpec:
    type: str
    default: object = None
    enum: list | None = None
    min: float | None = None
    max: float | None = None


@dataclass
class ComponentSpec:
    id: str
    version: str
    inputs: list[Port] = field(default_factory=list)
    outputs: list[Port] = field(default_factory=list)
    params: dict[str, ParamSpec] = field(default_factory=dict)
