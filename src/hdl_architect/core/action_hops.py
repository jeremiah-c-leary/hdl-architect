"""Hops of the actions table of HA 2: one item that goes from one action to
the next over one wire (a connection row of the table; in SysML a succession
flow between the two actions' items, over the connection between their
parts' ports). The item is said once, on the hop, so the two ends cannot
disagree: the egress of the source action and the ingress of the target
action are set to ports that carry an item of that item def, then linked.

Decided with the user (2026-11-26): the table is built by clicking source
ports on the sheet. A click on a port makes a hop over each wire from it,
and a new action on the part at the far end; the hop is saved once its item
and the new actions' action defs are chosen. An IP's items are fixed: the
rest of the design adapts to them.

(set_action_end in core/action_links.py sets one end; this sets both, and
makes the new actions, in one operation, so it is one undo step.)
"""

from __future__ import annotations

from dataclasses import dataclass

from hdl_architect.core import action_ops
from hdl_architect.core.action_links import (
    EGRESS,
    INGRESS,
    ActionEnd,
    Row,
    link_to_sheet,
    performer_of,
    placed_actions,
    set_action_end,
    unlink,
)
from hdl_architect.core.actions import allocated_part, has_wire
from hdl_architect.core.ops import Model, OpError, Result, _port, short


@dataclass
class HopEnd:
    """One end of a hop.

    - step: the action at this end; None: the sheet's own port;
    - port: the port it uses (of the step's part, or the sheet's own);
    - item: the action's item there now (a hop that is changed); None: the
      line on that port with the hop's item def, else a new one;
    - new: {"part", "action"}: make the action first, on that part, of that
      action def (named after it).
    """

    step: str | None
    port: str
    item: str | None = None
    new: dict | None = None


@dataclass
class Hop:
    """What one hop says: where it goes, and the item it carries."""

    sheet: str
    perform: str
    source: HopEnd
    target: HopEnd
    name: str  # the item's name, for any port item or action item made
    type: str  # its item def


def set_hop(model: Model, hop: Hop) -> Result:
    """Make the hop's new actions, set the source's egress and the target's
    ingress to the hop's item, and link the two."""
    check_hop(hop)
    notes, data = make_new_actions(model, hop)
    found = action_ops.performance(model, hop.sheet, hop.perform)
    check_wired(found, hop)
    for end, direction in ((hop.source, EGRESS), (hop.target, INGRESS)):
        if end.step is not None:
            notes += set_end(model, (found, hop), end, direction)
    notes += link_hop(model, found, hop)
    return Result([], notes, data)


def check_hop(hop: Hop) -> None:
    if (
        hop.source.step is None
        and hop.target.step is None
        and not (hop.source.new or hop.target.new)
    ):
        raise OpError("bad_request", "a hop needs an action at one end at least")
    action_ops.check_name(hop.name, "item")
    action_ops.check_name(hop.type, "item def")


def make_new_actions(model: Model, hop: Hop) -> tuple[list[str], dict]:
    """The actions asked for at either end, each named after its action def
    (ReadFrame: readFrame, or readFrame_2 if taken). Their names are the
    operation's data: {"source": name, "target": name}."""
    notes, data = [], {}
    for key, end in (("source", hop.source), ("target", hop.target)):
        if not end.new:
            continue
        found = action_ops.performance(model, hop.sheet, hop.perform)
        name = unique_step_name(found.action, end.new["action"])
        step = {"name": name, "part": end.new["part"], "action": end.new["action"]}
        notes += action_ops.add_step(model, hop.sheet, hop.perform, step).notes
        end.step = name
        data[key] = name
    return notes, data


def unique_step_name(action: dict, action_def: str) -> str:
    base = action_ops.lower_first(short(action_def))
    taken = {step["name"] for step in action.get("actions", [])}
    name, number = base, 2
    while name in taken:
        name, number = f"{base}_{number}", number + 1
    return name


def check_wired(found, hop: Hop) -> None:
    """A hop goes over a wire between its two ports."""
    source = end_on_sheet(found, hop.source)
    target = end_on_sheet(found, hop.target)
    if not has_wire(found.owner, source, target):
        raise OpError(
            "no_wire", f"no wire from {end_text(source)} to {end_text(target)}"
        )


def end_on_sheet(found, end: HopEnd) -> tuple:
    """(part, port) of a hop end; (None, port) for the sheet's own port."""
    if end.step is None:
        return (None, end.port)
    part = allocated_part(found.owner, found.step_ref(end.step))
    if part is None:
        raise OpError("not_allocated", f"{end.step} is not performed by a part yet")
    return (part["name"], end.port)


def end_text(end: tuple) -> str:
    part, port = end
    return port if part is None else f"{part}.{port}"


# ---------------------------------------------------------------- one end


def set_end(model: Model, where: tuple, end: HopEnd, direction: str) -> list[str]:
    """The end's line: its port, carrying an item of the hop's item def."""
    found, hop = where
    performer = performer_of(model, found, end.step)
    port = _port(model, performer.def_name, end.port)[3]
    line = ActionEnd(direction, port=end.port)
    carried_item(port, (direction, hop), line)
    ip = action_ops.is_ip(model, performer.def_name)
    if ip and line.new_port_item:
        raise OpError(
            "ip_actions",
            f"{performer.def_name} is IP: its port {end.port} carries no "
            f"{direction} item of {short(hop.type)}",
        )
    current = end.item or line_item_on(model, found, (end, direction, hop.type))
    if current is not None:
        same_item_or_replace(performer, current, (hop.type, line))
    elif ip:
        line.item = ip_item(performer, direction, hop.type)
    row = Row(hop.sheet, hop.perform, end.step)
    return set_action_end(model, row, line).notes


def carried_item(port: dict, wanted: tuple, line: ActionEnd) -> None:
    """The port's item of the hop's item def in the line's direction (the
    one named like the hop's item first), else a new one."""
    direction, hop = wanted
    carried = [
        item
        for item in port.get("items", [])
        if item["direction"] == direction
        and action_ops.type_of(item) == short(hop.type)
    ]
    named = [item for item in carried if item["name"] == hop.name]
    if named or carried:
        line.port_item = (named or carried)[0]["name"]
        return
    name = unique_port_item_name(port, hop.name)
    line.new_port_item = {"name": name, "type": hop.type}


def unique_port_item_name(port: dict, base: str) -> str:
    taken = {item["name"] for item in port.get("items", [])}
    name, number = base, 2
    while name in taken:
        name, number = f"{base}_{number}", number + 1
    return name


def line_item_on(model: Model, found, wanted: tuple) -> str | None:
    """The action's item already on that port with that item def, if any."""
    end, direction, type_ = wanted
    for line in lines_of_step(model, found, (end.step, direction)):
        if line_matches(line, end.port, type_):
            return line.item["name"]
    return None


def lines_of_step(model: Model, found, wanted: tuple) -> list:
    step, direction = wanted
    for placed in placed_actions(model, found):
        if placed.name == step:
            return placed.lines_of(direction)
    return []


def line_matches(line, port: str, type_: str) -> bool:
    if line.end is None or line.end[1] != port:
        return False
    return action_ops.type_of(line.item) == short(type_)


def same_item_or_replace(performer, current: str, wanted: tuple) -> None:
    """The line stays the action's item `current` if it is of the hop's item
    def; else the hop's item replaces it (not on IP)."""
    type_, line = wanted
    item = action_ops.find_parameter(performer.action, current)
    if action_ops.type_of(item) == short(type_):
        line.item = current
        return
    line.replaces = current


def ip_item(performer, direction: str, type_: str) -> str:
    """An IP's action has its own items: the one of the hop's item def."""
    for item in performer.action.get("parameters", []):
        if item["direction"] == direction and action_ops.type_of(item) == short(type_):
            return item["name"]
    raise OpError(
        "ip_actions",
        f"{performer.def_name} is IP: {performer.action_name} has no "
        f"{direction} item of {short(type_)}",
    )


# ---------------------------------------------------------------- the link


def link_hop(model: Model, found, hop: Hop) -> list[str]:
    """`succession flow from source to target;`, or the binding to the
    composed action's own item when one end is the sheet's own port."""
    source = hop_line(model, found, (hop.source, EGRESS, hop.type))
    target = hop_line(model, found, (hop.target, INGRESS, hop.type))
    if source is None:
        unlink(found.action, target.ref)
        return link_to_sheet(model, (found, hop.source.port), target)
    if target is None:
        if is_bound(found.action, source.ref):
            return []
        return link_to_sheet(model, (found, hop.target.port), source)
    unlink(found.action, target.ref)
    action_ops.add_item_link(found.action, source.ref, target.ref)
    return [f"{target.ref} gets {source.ref}."]


def hop_line(model: Model, found, wanted: tuple):
    """The line a hop end is now; None at the sheet's own port."""
    end, direction, type_ = wanted
    if end.step is None:
        return None
    for line in lines_of_step(model, found, (end.step, direction)):
        if line_matches(line, end.port, type_):
            return line
    raise OpError("internal", f"{end.step} has no {direction} line on {end.port}")


def is_bound(action: dict, ref: str) -> bool:
    return any(ref in binding["ends"] for binding in action.get("bindings", []))


# ---------------------------------------------------------------- the table


def hop_end(args: dict) -> HopEnd:
    """A hop end as the browser sends it."""
    if not isinstance(args, dict) or not isinstance(args.get("port"), str):
        raise OpError("bad_request", "a hop end is {step, port, item?, new?}")
    new = args.get("new")
    if new is not None and not (
        isinstance(new, dict)
        and isinstance(new.get("part"), str)
        and isinstance(new.get("action"), str)
    ):
        raise OpError("bad_request", "a new action is {part, action}")
    return HopEnd(args.get("step"), args["port"], args.get("item"), new)


def hop_of(args: dict) -> Hop:
    item = args["item"]
    if not isinstance(item, dict):
        raise OpError("bad_request", "item is {name, type}")
    return Hop(
        args["sheet"],
        args["perform"],
        hop_end(args["source"]),
        hop_end(args["target"]),
        item.get("name"),
        item.get("type"),
    )


# name -> (call, required arguments, optional arguments), as ops.OPERATIONS.
HOP_OPERATIONS = {
    "set_hop": (
        action_ops.tracked(lambda m, a: set_hop(m, hop_of(a))),
        ["sheet", "perform", "source", "target", "item"],
        [],
    ),
}
