"""Performed actions: what a part def does, step by step, and through which
ports. (HA 1 called these features and feature arcs.)

The model (examples/wifi_router shows it):

- A part def performs actions: `perform action readSensor : ReadSensor;`.
- A port declares the items it carries (`port temp_read : Axi4LiteSubordinate
  { in item request : TemperatureRequest; out item temperature : Temperature; }`),
  and the part def's flows say which port each of the action's items enters
  or leaves by: `flow from temp_read.request to readSensor.request;`,
  `flow from readSensor.temperature to temp_read.temperature;`.
- An action def with steps is composed: each step is allocated to a part of
  the part def that performs it (`allocate readTemperature.readSensor to
  temp_if;`), and that part's def must perform the step's action def. A flow
  between steps on two parts travels on the wire between their ports; an item
  of the action itself enters or leaves at the sheet's edge, on a wire from
  the sheet's port to the step's part.
- A step is "to break down" when its part is a roll-up block (with parts, or
  of a roll-up kind) and the step's action def has no steps yet: the design
  is described one level at a time.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from hdl_architect.core.model import _JsonModel
from hdl_architect.core.resources import ROLL_UP_KINDS, part_generals

# A step's status: how far its part's side is described.
PERFORMED = "performed"  # a leaf performs it
DECOMPOSED = "decomposed"  # its action def has steps of its own, on parts
TO_BREAK_DOWN = "to break down"  # a roll-up block performs it, no steps yet
NOT_PERFORMED = "not performed"  # its part's def does not perform it
NOT_ALLOCATED = "not allocated"  # no part does it


@dataclass
class ItemPort:
    """An action's item and the port it enters or leaves by (None: not said)."""

    item: str
    item_type: str
    direction: str  # "in" or "out"
    port: str | None
    port_item: str | None = None  # the port's own item it travels as


@dataclass
class Step:
    """One step of a composed action: who performs it, and how."""

    name: str
    action_def: str
    part: str | None
    part_def: str | None
    status: str
    items: list[ItemPort] = field(default_factory=list)
    steps: list[Step] = field(default_factory=list)  # when DECOMPOSED


@dataclass
class PerformedAction:
    """An action a part def performs: its items' ports, and its steps."""

    owner: str  # the part def
    name: str  # the perform usage
    action_def: str
    items: list[ItemPort]
    steps: list[Step]


@dataclass
class ActionReport:
    actions: list[PerformedAction]
    problems: list[str]


def action_report(search_path, top: str) -> ActionReport:
    """Every action `top` performs, its steps all the way down, and problems."""
    model = _JsonModel(search_path)
    walk = ActionWalk(model)
    owner, _ = model.get(top, "partDefs", top)
    actions = [walk.performed(owner, perform) for perform in owner.get("performs", [])]
    return ActionReport(actions, walk.problems)


class ActionWalk:
    """Walks the performed actions and their steps, collecting problems."""

    def __init__(self, model: _JsonModel):
        self.model = model
        self.problems: list[str] = []

    def problem(self, text: str) -> None:
        if text not in self.problems:
            self.problems.append(text)

    # ------------------------------------------------------------ one action

    def performed(self, owner: dict, perform: dict) -> PerformedAction:
        action = self.action_def(perform["type"])
        items = self.items_of(owner, perform["name"], action)
        steps = self.steps_of(owner, perform["name"], action)
        self.check_wires(owner, perform["name"], action, steps)
        return PerformedAction(
            owner["name"], perform["name"], action["name"], items, steps
        )

    def action_def(self, name: str) -> dict:
        definition, _ = self.model.get(name, "actionDefs", name)
        return definition

    def items_of(self, owner: dict, perform_name: str, action: dict) -> list[ItemPort]:
        """The action's items, each with the port of `owner` it uses."""
        items = [
            item_port(owner, perform_name, parameter)
            for parameter in action.get("parameters", [])
        ]
        for item in items:
            self.check_item_port(owner, perform_name, item)
        return items

    def check_item_port(self, owner: dict, perform_name: str, item: ItemPort) -> None:
        if item.port is None:
            self.problem(no_port_text(owner["name"], perform_name, item))
        elif not carries(owner, item):
            self.problem(
                f"{owner['name']}: port {item.port} does not carry "
                f"{item.direction} item {item.port_item}"
            )

    # ------------------------------------------------------------ its steps

    def steps_of(self, owner: dict, perform_name: str, action: dict) -> list[Step]:
        return [
            self.step(owner, perform_name, step) for step in action.get("actions", [])
        ]

    def step(self, owner: dict, perform_name: str, step: dict) -> Step:
        where = f"{owner['name']}: {perform_name}.{step['name']}"
        part = allocated_part(owner, f"{perform_name}.{step['name']}")
        if part is None:
            self.problem(f"{where} is not allocated to a part")
            return Step(step["name"], step.get("type", ""), None, None, NOT_ALLOCATED)
        part_def_name = unqualified(part["type"])
        performance = self.performance_of(part_def_name, step.get("type"))
        if performance is None:
            self.problem(
                f"{where}: {part_def_name} does not perform {step.get('type')}"
            )
            return Step(
                step["name"],
                step.get("type", ""),
                part["name"],
                part_def_name,
                NOT_PERFORMED,
            )
        return self.performed_step(step, part, performance)

    def performance_of(self, part_def_name: str, action_def: str | None) -> dict | None:
        """The part def's perform usage of an action def, or None."""
        definition, _ = self.model.get(part_def_name, "partDefs", part_def_name)
        for perform in definition.get("performs", []):
            if action_def and unqualified(perform["type"]) == unqualified(action_def):
                return perform
        return None

    def performed_step(self, step: dict, part: dict, perform: dict) -> Step:
        part_def, _ = self.model.get(part["type"], "partDefs", part["type"])
        action = self.action_def(perform["type"])
        made = Step(
            step["name"], action["name"], part["name"], part_def["name"], PERFORMED
        )
        made.items = self.items_of(part_def, perform["name"], action)
        if action.get("actions"):
            made.status = DECOMPOSED
            made.steps = self.performed(part_def, perform).steps
        elif self.is_roll_up(part_def):
            made.status = TO_BREAK_DOWN
        return made

    def is_roll_up(self, definition: dict) -> bool:
        if definition.get("parts"):
            return True
        return bool(ROLL_UP_KINDS & part_generals(self.model, definition["name"]))

    # ------------------------------------------------------------ wires

    def check_wires(
        self, owner: dict, perform_name: str, action: dict, steps: list[Step]
    ) -> None:
        """Every item that moves between parts, or to the edge, needs a wire."""
        by_name = {step.name: step for step in steps}
        for flow in action.get("flows", []):
            self.check_step_flow(owner, flow, by_name)
        for binding in action.get("bindings", []):
            self.check_edge(owner, perform_name, binding, by_name)

    def check_step_flow(self, owner: dict, flow: dict, by_name: dict) -> None:
        source = end_of(flow["from"], by_name, "out")
        target = end_of(flow["to"], by_name, "in")
        if source is None or target is None or source[0] == target[0]:
            return  # unknown, no port said (reported), or within one part
        if not has_wire(owner, source, target):
            item = flow["from"].split(".")[-1]
            self.problem(
                f"{owner['name']}: {item} ({flow['from']} -> {flow['to']}): no wire "
                f"from {source[0]}.{source[1]} to {target[0]}.{target[1]}"
            )

    def check_edge(
        self, owner: dict, perform_name: str, binding: dict, by_name: dict
    ) -> None:
        """`bind step.item = actionItem`: the sheet's port to the step's part."""
        step_end, action_item = binding["ends"]
        direction = direction_in(owner, perform_name, action_item)
        sheet_end = port_end_for(owner, f"{perform_name}.{action_item}", direction)
        part_end = end_of(step_end, by_name, direction)
        sheet_port = sheet_end.split(".")[0] if sheet_end else None
        if sheet_port is None or part_end is None:
            return
        if not has_wire(owner, (None, sheet_port), part_end):
            self.problem(
                f"{owner['name']}: {action_item}: no wire from the sheet's "
                f"{sheet_port} to {part_end[0]}.{part_end[1]}"
            )


# ---------------------------------------------------------------- model lookups


def item_port(owner: dict, perform_name: str, parameter: dict) -> ItemPort:
    direction = parameter["direction"]
    item_ref = f"{perform_name}.{parameter['name']}"
    port_end = port_end_for(owner, item_ref, direction)
    made = ItemPort(parameter["name"], parameter["type"], direction, None)
    if port_end:
        made.port, _, made.port_item = port_end.partition(".")
    return made


def port_end_for(owner: dict, item_ref: str, direction: str) -> str | None:
    """The port end ("temp_read.request") an item enters by (`flow from
    port.item to item_ref`) or leaves by (`flow from item_ref to port.item`)."""
    for flow in owner.get("flows", []):
        if (
            direction == "in"
            and flow["to"] == item_ref
            and is_port_end(owner, flow["from"])
        ):
            return flow["from"]
        if (
            direction == "out"
            and flow["from"] == item_ref
            and is_port_end(owner, flow["to"])
        ):
            return flow["to"]
    return None


def is_port_end(owner: dict, end: str) -> bool:
    """Whether a flow end names one of `owner`'s ports (with or without an item)."""
    return end.split(".")[0] in port_names(owner)


def port_names(owner: dict) -> set[str]:
    return {usage.get("shortName") or usage["name"] for usage in owner.get("ports", [])}


def carries(owner: dict, item: ItemPort) -> bool:
    """Whether the port declares the item, in the item's direction."""
    port = next(
        usage
        for usage in owner.get("ports", [])
        if (usage.get("shortName") or usage["name"]) == item.port
    )
    return any(
        declared["name"] == item.port_item and declared["direction"] == item.direction
        for declared in port.get("items", [])
    )


def direction_in(owner: dict, perform_name: str, item: str) -> str:
    """Whether an item of a performed action goes into it or out of it."""
    for flow in owner.get("flows", []):
        if flow["to"] == f"{perform_name}.{item}":
            return "in"
    return "out"


def allocated_part(owner: dict, step_ref: str) -> dict | None:
    """The part a step is allocated to: `allocate step_ref to part;`."""
    for allocation in owner.get("allocations", []):
        if allocation["from"] == step_ref:
            return find_part(owner, allocation["to"])
    return None


def find_part(owner: dict, name: str) -> dict | None:
    return next((p for p in owner.get("parts", []) if p["name"] == name), None)


def end_of(step_item: str, by_name: dict, direction: str) -> tuple | None:
    """(part, port) where a step's item crosses its part's boundary."""
    step_name, _, item = step_item.partition(".")
    step = by_name.get(step_name)
    if step is None or step.part is None:
        return None
    port = next((i.port for i in step.items if i.item == item), None)
    if port is None:
        return None
    return (step.part, port)


def has_wire(owner: dict, end_a: tuple, end_b: tuple) -> bool:
    """A connection or binding of `owner` between two ends; (None, port) is
    the sheet's own port."""
    wanted = {end_text(end_a), end_text(end_b)}
    wires = owner.get("connections", []) + owner.get("bindings", [])
    return any(set(wire["ends"]) == wanted for wire in wires)


def end_text(end: tuple) -> str:
    part, port = end
    if part is None:
        return port
    return f"{part}.{port}"


def no_port_text(owner: str, perform_name: str, item: ItemPort) -> str:
    way = "enters" if item.direction == "in" else "leaves"
    return (
        f"{owner}: {perform_name}.{item.item} does not say which port it {way} by "
        f"(a flow between a port's item and {perform_name}.{item.item})"
    )


def unqualified(name: str | None) -> str:
    return (name or "").split("::")[-1]
