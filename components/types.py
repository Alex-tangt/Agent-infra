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

    def validate(self, value: object, component_id: str = "", name: str = "") -> None:
        label = f"parameter {name!r} for component {component_id!r}" if component_id or name else f"parameter {name!r}"
        if self.type == "string" and not isinstance(value, str):
            raise ValueError(f"{label} must be a string, got {value!r}")
        if self.type == "integer" and not (isinstance(value, int) and not isinstance(value, bool)):
            raise ValueError(f"{label} must be an integer, got {value!r}")
        if self.type == "number" and not (isinstance(value, (int, float)) and not isinstance(value, bool)):
            raise ValueError(f"{label} must be a number, got {value!r}")
        if self.type == "list" and not isinstance(value, list):
            raise ValueError(f"{label} must be a list, got {value!r}")
        if self.enum is not None and value not in self.enum:
            raise ValueError(
                f"{label} must be one of {self.enum}, got {value!r}"
            )
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            if self.min is not None and value < self.min:
                raise ValueError(f"{label} below min {self.min}")
            if self.max is not None and value > self.max:
                raise ValueError(f"{label} above max {self.max}")


@dataclass
class ComponentSpec:
    id: str
    version: str
    inputs: list[Port] = field(default_factory=list)
    outputs: list[Port] = field(default_factory=list)
    params: dict[str, ParamSpec] = field(default_factory=dict)
    description: str = ""
    role: str = ""
