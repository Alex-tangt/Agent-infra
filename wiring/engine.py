from recipe import Recipe, validate as validate_recipe


class _Template:
    def __init__(self, import_line, register_call, class_name, steps):
        self.import_line = import_line
        self.register_call = register_call
        self.class_name = class_name
        self.steps = steps


_TEMPLATES: dict[str, _Template] = {
    "context-window": _Template(
        import_line="from components.context import register_context, ContextWindow",
        register_call="register_context()",
        class_name="ContextWindow",
        steps=lambda instance, source, output: [
            f"{instance}.add_user_message({source})",
            f"{output} = {instance}.get_messages()",
        ],
    ),
    "model-openai": _Template(
        import_line="from components.model import register_model, OpenAIModel",
        register_call="register_model()",
        class_name="OpenAIModel",
        steps=lambda instance, source, output: [
            f"{output} = {instance}.generate({source})",
        ],
    ),
    "model-ollama": _Template(
        import_line="from components.model import register_ollama_model, OllamaModel",
        register_call="register_ollama_model()",
        class_name="OllamaModel",
        steps=lambda instance, source, output: [
            f"{output} = {instance}.generate({source})",
        ],
    ),
    "tool-caller": _Template(
        import_line="from components.tools import register_tool_caller, ToolCaller, Tool",
        register_call="register_tool_caller()",
        class_name="ToolCaller",
        steps=lambda instance, source, output: [
            f"{output} = {instance}.call({source})",
        ],
    ),
    "agent-single": _Template(
        import_line="from components.agent import register_agent, Agent",
        register_call="register_agent()",
        class_name="Agent",
        steps=lambda instance, source, output: [
            f"{output} = {instance}.run({source})",
        ],
    ),
}

_AGENT_COMPONENTS = {"agent-single"}
_ROLE_BY_COMPONENT = {
    "context-window": "context",
    "model-openai": "model",
    "model-ollama": "model",
    "tool-caller": "tools",
}


def _is_agent_component(component_id: str) -> bool:
    return component_id in _AGENT_COMPONENTS


def _sanitize(component_id: str) -> str:
    return "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in component_id)


def _instance_var(component_id: str) -> str:
    return _sanitize(component_id)


def _output_var(component_id: str) -> str:
    return f"v_{_sanitize(component_id)}"


def _literal(value: object) -> str:
    return repr(value)


def _construct(entry: dict, spec, parameters: dict, connections: list) -> str:
    cid = entry["id"]
    if _is_agent_component(cid):
        return _construct_agent(entry, spec, parameters, _agent_parts(cid, connections))
    params = {name: spec.params[name].default for name in spec.params}
    params.update(parameters.get(entry["id"], {}))
    template = _TEMPLATES[entry["id"]]
    kwargs = ", ".join(
        f"{name}={_render_param_value(entry['id'], name, value)}"
        for name, value in params.items()
    )
    return f"{_instance_var(entry['id'])} = {template.class_name}({kwargs})"


def _render_param_value(component_id: str, name: str, value: object) -> str:
    if component_id == "tool-caller" and name == "tools":
        return _render_tools(value)
    return _literal(value)


def _render_tools(tools: list) -> str:
    rendered = []
    for tool in tools:
        parts = [
            f"name={_literal(tool.get('name', ''))}",
            f"description={_literal(tool.get('description', ''))}",
            f"parameters={_literal(tool.get('parameters', {}))}",
        ]
        func = tool.get("func")
        if func is not None:
            parts.append(f"func=({func})")
        rendered.append(f"Tool({', '.join(parts)})")
    return "[" + ", ".join(rendered) + "]"


def _agent_parts(component_id: str, connections: list) -> dict:
    parts = {}
    for connection in connections:
        if connection["to"] != component_id:
            continue
        part_id = connection["from"]
        role = _ROLE_BY_COMPONENT.get(part_id)
        if role is None:
            raise ValueError(
                f"component {part_id!r} cannot be wired as a part of agent "
                f"{component_id!r}; expected one of {sorted(_ROLE_BY_COMPONENT)}"
            )
        if role in parts:
            raise ValueError(
                f"agent {component_id!r} receives multiple {role!r} parts"
            )
        parts[role] = part_id
    missing = sorted(set(("model", "context", "tools")) - set(parts))
    if missing:
        raise ValueError(
            f"agent {component_id!r} is missing parts {missing}; "
            "wire model-openai, context-window and tool-caller into it"
        )
    return parts


def _construct_agent(entry: dict, spec, parameters: dict, parts: dict) -> str:
    cid = entry["id"]
    params = {name: spec.params[name].default for name in spec.params}
    params.update(parameters.get(entry["id"], {}))
    kwargs = (
        f"model={_instance_var(parts['model'])}, "
        f"context={_instance_var(parts['context'])}, "
        f"tools={_instance_var(parts['tools'])}"
    )
    for name, value in params.items():
        kwargs += f", {name}={_literal(value)}"
    return f"{_instance_var(entry['id'])} = Agent({kwargs})"


def _topological_order(components: list, connections: list) -> list:
    ids = [c["id"] for c in components]
    index = {cid: i for i, cid in enumerate(ids)}
    incoming = {cid: set() for cid in ids}
    outgoing = {cid: set() for cid in ids}
    for connection in connections:
        outgoing[connection["from"]].add(connection["to"])
        incoming[connection["to"]].add(connection["from"])

    counts = {cid: len(incoming[cid]) for cid in ids}
    ready = sorted((cid for cid in ids if counts[cid] == 0), key=index.__getitem__)
    order = []
    while ready:
        cid = ready.pop(0)
        order.append(cid)
        for nxt in sorted(outgoing[cid], key=index.__getitem__):
            counts[nxt] -= 1
            if counts[nxt] == 0:
                ready.append(nxt)
                ready.sort(key=index.__getitem__)

    if len(order) != len(ids):
        raise ValueError(
            f"connections form a cycle; cannot build a serial call chain: {ids}"
        )
    return order


def _chain(recipe: Recipe) -> list:
    order = _topological_order(recipe.components, recipe.connections)
    connected = set()
    for connection in recipe.connections:
        connected.add(connection["from"])
        connected.add(connection["to"])
    if not connected:
        return order
    chain = [cid for cid in order if cid in connected]
    return [cid for cid in chain if not _is_agent_part(cid, recipe)]


def _is_agent_part(component_id: str, recipe: Recipe) -> bool:
    if _is_agent_component(component_id):
        return False
    targets = [
        connection["to"]
        for connection in recipe.connections
        if connection["from"] == component_id
    ]
    return bool(targets) and all(_is_agent_component(target) for target in targets)


def _chain_steps(recipe: Recipe, chain: list) -> tuple[list, str]:
    steps = []
    last_output = ""
    for cid in chain:
        instance = _instance_var(cid)
        output = _output_var(cid)
        template = _TEMPLATES[cid]
        if _is_agent_component(cid):
            sources = []
        else:
            sources = [
                connection["from"]
                for connection in recipe.connections
                if connection["to"] == cid
            ]
        if len(sources) > 1:
            raise ValueError(
                f"component {cid!r} receives multiple connections; "
                "fan-in is not supported by the serial call chain"
            )
        source = _output_var(sources[0]) if sources else "user_message"
        steps.extend(template.steps(instance, source, output))
        last_output = output
    return steps, last_output


def _render(recipe: Recipe, specs: dict) -> str:
    lines = [
        f'# 胶水代码：agent "{recipe.name}"',
        "# 由接线引擎按模板生成；配方即弃后，作为普通代码直接修改",
        "",
    ]
    import_lines = []
    register_lines = []
    construct_lines = []
    by_id = {entry["id"]: entry for entry in recipe.components}
    seen = set()
    for cid in _topological_order(recipe.components, recipe.connections):
        if cid in seen:
            continue
        seen.add(cid)
        template = _TEMPLATES[cid]
        import_lines.append(template.import_line)
        register_lines.append(template.register_call)
        construct_lines.append(
            _construct(by_id[cid], specs[cid], recipe.parameters, recipe.connections)
        )

    lines.extend(import_lines)
    lines.append("")
    lines.extend(register_lines)
    lines.append("")
    lines.extend(construct_lines)
    lines.append("")
    lines.append("")
    lines.append("def run(user_message: str):")
    steps, last_output = _chain_steps(recipe, _chain(recipe))
    lines.extend(f"    {step}" for step in steps)
    lines.append(f"    return {last_output}")
    lines.append("")
    return "\n".join(lines)


def _check_contract(connection: dict, specs: dict) -> None:
    from_id, to_id = connection["from"], connection["to"]
    if _is_agent_component(to_id):
        return
    output_types = [p.type for p in specs[from_id].outputs]
    input_types = [p.type for p in specs[to_id].inputs]
    if not set(output_types) & set(input_types):
        raise ValueError(
            f"connection contract mismatch: {from_id} -> {to_id}: "
            f"output types {output_types} do not match input types {input_types}"
        )


def _check_chain_head(chain: list, specs: dict, connections: list) -> None:
    for cid in chain:
        has_incoming = any(c["to"] == cid for c in connections)
        if has_incoming:
            continue
        input_types = [p.type for p in specs[cid].inputs]
        if "string" not in input_types:
            raise ValueError(
                f"component {cid!r} has no incoming connection and its input types "
                f"({input_types}) do not accept the chain head 'user_message' (string); "
                f"add a connection or a string-input component"
            )


def generate(recipe: dict | Recipe, registry: dict) -> str:
    if isinstance(recipe, Recipe):
        recipe = {
            "name": recipe.name,
            "components": recipe.components,
            "connections": recipe.connections,
            "parameters": recipe.parameters,
        }
    if not isinstance(recipe, dict):
        raise TypeError("recipe must be a dict or Recipe")
    recipe = validate_recipe(recipe, registry=registry)

    specs = {}
    for entry in recipe.components:
        cid, version = entry["id"], entry["version"]
        spec = registry.get((cid, version))
        if spec is None:
            raise ValueError(f"unknown component: {cid}@{version} not in registry")
        if cid not in _TEMPLATES:
            raise ValueError(f"no glue template registered for component {cid!r}")
        specs[cid] = spec

    for connection in recipe.connections:
        _check_contract(connection, specs)

    chain = _chain(recipe)
    _check_chain_head(chain, specs, recipe.connections)

    return _render(recipe, specs)
