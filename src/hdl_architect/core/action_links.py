"""The actions table of HA 2: each action of a composed action def is a row,
performed by a part of the sheet, that takes items in by a port of that part
(its ingress) and gives items out by a port (its egress), like a timing arc
through a cell. Which action feeds which is not chosen: it is worked out
from the wires on the sheet (the net arcs), and written as SysML.

Decided with the user (2026-11-26):

- An ingress or egress line is a port of the performer and an item that
  port carries (`port cmd { in item axi4liteRead : Axi4LiteRead; }`). The
  action def gets an item of the same name and item def, unless the line is
  one of its items already, and the performer's part def says which port it
  uses (`flow from cmd.axi4liteRead to rxFrameReq.axi4liteRead;`).
- An action's ingress is fed by the latest earlier action whose egress is
  on a port wired to it, with the same item def:
  `succession flow from readFrame.axi4liteRead to rxFrameReq.axi4liteRead;`.
  An ingress on a port wired to the sheet's own port is fed by the sheet:
  the composed action def gets the item itself (`in item ethPacket :
  EthPacket;`), which enters by that port, and
  `bind receiveFrame.ethPacket = ethPacket;`. An egress on a port wired to
  the sheet's own port leaves the composed action the same way.
- A link already in the model is kept; only lines without one are worked
  out (a line that changes loses its links first).

(The operations on steps, performs and items that this builds on are
core/action_ops.py; the walk that reads them back is core/actions.py.)
"""

from __future__ import annotations

from dataclasses import dataclass, field

from hdl_architect.core import action_ops
from hdl_architect.core.actions import allocated_part, has_wire, port_end_for
from hdl_architect.core.ops import Model, OpError, Result, _port, ident, short

INGRESS = "in"
EGRESS = "out"


@dataclass
class Row:
    """One action of the table: action `step` of what `sheet` performs as
    `perform`."""

    sheet: str
    perform: str
    step: str


@dataclass
class ActionEnd:
    """What one ingress or egress line of a row says.

    - direction: "in" (ingress) or "out" (egress);
    - item: the row's action def's item the line is; None for a new line;
    - port: the performer's port (its identifier); None: no port yet;
    - port_item: an item that port carries;
    - new_port_item: {"name", "type"}: an item the port carries from now on;
    - replaces: an item of the action def that the line's new item takes
      the place of (it goes, with everything that refers to it).
    """

    direction: str
    item: str | None = None
    port: str | None = None
    port_item: str | None = None
    new_port_item: dict | None = None
    replaces: str | None = None


@dataclass
class Performer:
    """The part a row's action is allocated to, and what it performs."""

    part: str  # the part usage on the sheet
    def_name: str  # its part def
    owner: dict  # that part def
    perform: str  # its perform of the row's action def
    action_name: str  # the row's action def
    action: dict


@dataclass
class Line:
    """One item of a placed action, and where it crosses its part's boundary."""

    ref: str  # "step.item", as the composed action def's flows name it
    item: dict  # the action def's parameter: name, direction, type
    end: tuple | None  # (part, port), or None if it says no port yet
    port_item: str | None = None  # the item of that port it uses


@dataclass
class Placed:
    """An action of the composed action def, in its place in the order."""

    index: int
    name: str
    lines: list[Line] = field(default_factory=list)

    def lines_of(self, direction: str) -> list[Line]:
        return [line for line in self.lines if line.item["direction"] == direction]


# ---------------------------------------------------------------- one line


def set_action_end(model: Model, row: Row, end: ActionEnd) -> Result:
    """Set one ingress or egress line of a row: its port and the item that
    port carries (or no port), then work out the links it now has."""
    check_direction(end.direction)
    found = action_ops.performance(model, row.sheet, row.perform)
    performer = performer_of(model, found, row.step)
    if end.port is None:
        return clear_end(model, (found, performer, row), end)
    port = _port(model, performer.def_name, end.port)[3]
    port_item = chosen_port_item(port, end)
    notes = remove_replaced(model, performer, (end, port_item))
    item = chosen_action_item(model, performer, end, port_item)
    notes += add_port_item(model, (performer, port), end)
    notes += add_line_item(model, performer, item)
    via = {"item": item["name"], "port": end.port, "portItem": port_item["name"]}
    notes += action_ops.set_item_port(
        model, performer.def_name, performer.perform, via
    ).notes
    unlink(found.action, f"{row.step}.{item['name']}")
    notes += work_out_links(model, found)
    return Result([], notes)


def remove_replaced(model: Model, performer: Performer, line: tuple) -> list[str]:
    """The item the line's new item takes the place of goes (checked first:
    a refusal must change nothing)."""
    end, port_item = line
    if not end.replaces:
        return []
    if end.item:
        raise OpError("bad_request", "a line is either an item, or replaces one")
    old = action_ops.find_parameter(performer.action, end.replaces)
    if old["direction"] != end.direction:
        raise OpError("direction", f"{end.replaces} is {old['direction']}")
    if action_ops.is_ip(model, performer.def_name):
        raise OpError(
            "ip_actions", f"{performer.def_name} is IP: its items are its own"
        )
    action_ops.check_name(port_item["name"], "item")
    return action_ops.delete_action_item(
        model, performer.action_name, end.replaces
    ).notes


def check_direction(direction: str) -> None:
    if direction not in (INGRESS, EGRESS):
        raise OpError("bad_request", 'direction must be "in" or "out"')


def performer_of(model: Model, found, step: str) -> Performer:
    """The part the row's action is allocated to; refused if none performs it."""
    the_step = action_ops.find_step(found.action, step)
    part = allocated_part(found.owner, found.step_ref(step))
    if part is None:
        raise OpError("not_allocated", f"{step} is not performed by a part yet")
    def_name = short(part["type"])
    owner = model.part_def(def_name)[2]
    perform = action_ops.perform_of(owner, the_step["type"])
    if perform is None:
        raise OpError(
            "not_performed", f"{def_name} does not perform {the_step['type']}"
        )
    action_name = short(the_step["type"])
    action = action_ops.action_def(model, action_name)[2]
    return Performer(
        part["name"], def_name, owner, perform["name"], action_name, action
    )


def clear_end(model: Model, where: tuple, end: ActionEnd) -> Result:
    """No port: the line's item no longer says which port it uses, and loses
    its links."""
    found, performer, row = where
    if end.item is None:
        raise OpError("bad_request", "say which item of the action has no port")
    action_ops.find_parameter(performer.action, end.item)
    via = {"item": end.item}
    notes = action_ops.set_item_port(
        model, performer.def_name, performer.perform, via
    ).notes
    unlink(found.action, f"{row.step}.{end.item}")
    return Result([], notes)


def chosen_port_item(port: dict, end: ActionEnd) -> dict:
    """The port's item the line uses: one it carries, or the new one (not
    added yet: everything is checked before anything changes)."""
    if end.new_port_item:
        return new_port_item(port, end)
    if not end.port_item:
        raise OpError(
            "bad_request",
            "say which item the port carries (portItem), or a new one (newPortItem)",
        )
    declared = next(
        (item for item in port.get("items", []) if item["name"] == end.port_item),
        None,
    )
    if declared is None:
        raise OpError("not_found", f"port {ident(port)} has no item {end.port_item}")
    check_same_direction(port, declared, end.direction)
    return declared


def new_port_item(port: dict, end: ActionEnd) -> dict:
    name, type_ = end.new_port_item["name"], end.new_port_item["type"]
    action_ops.check_name(name, "item")
    if any(item["name"] == name for item in port.get("items", [])):
        raise OpError("exists", f"port {ident(port)} already carries an item {name}")
    return {"name": name, "direction": end.direction, "type": short(type_)}


def check_same_direction(port: dict, declared: dict, direction: str) -> None:
    if declared["direction"] != direction:
        raise OpError(
            "direction",
            f"{ident(port)}.{declared['name']} is {declared['direction']}, "
            f"not {direction}",
        )


def chosen_action_item(
    model: Model, performer: Performer, end: ActionEnd, port_item: dict
) -> dict:
    """The row's action def's item the line is: the one named, else the one
    named after the port's item in the same direction, else a new one (not
    for IP)."""
    if end.item:
        named = action_ops.find_parameter(performer.action, end.item)
        check_same_item(named, port_item)
        return named
    existing = parameter_named(performer.action, port_item)
    if existing is None:
        name = unique_parameter_name(performer.action, port_item["name"])
        return new_action_item(model, performer, (name, port_item))
    check_same_item(existing, port_item)
    return existing


def parameter_named(action: dict, port_item: dict) -> dict | None:
    """The action def's item with the port item's name and direction."""
    return next(
        (
            parameter
            for parameter in action.get("parameters", [])
            if parameter["name"] == port_item["name"]
            and parameter["direction"] == port_item["direction"]
        ),
        None,
    )


def new_action_item(model: Model, performer: Performer, named: tuple) -> dict:
    name, port_item = named
    if action_ops.is_ip(model, performer.def_name):
        raise OpError(
            "ip_actions",
            f"{performer.def_name} is IP: {performer.action_name} has no item "
            f"{name}, and IP brings its own actions",
        )
    action_ops.check_name(name, "item")
    return {
        "name": name,
        "direction": port_item["direction"],
        "type": port_item["type"],
        "new": True,
    }


def check_same_item(action_item: dict, port_item: dict) -> None:
    """The action's item and the port's item are the same kind of thing."""
    if action_item["direction"] != port_item["direction"]:
        raise OpError(
            "direction",
            f"{action_item['name']} is {action_item['direction']}, but the "
            f"port's {port_item['name']} is {port_item['direction']}",
        )
    if short(action_item["type"]) != short(port_item["type"]):
        raise OpError(
            "types",
            f"{action_item['name']} is {short(action_item['type'])}, but the "
            f"port's {port_item['name']} is {short(port_item['type'])}",
        )


def add_port_item(model: Model, where: tuple, end: ActionEnd) -> list[str]:
    """The port carries the line's new item from now on (if it is new)."""
    performer, port = where
    if not end.new_port_item:
        return []
    item = new_port_item(port, end)
    file, package, _ = model.part_def(performer.def_name)
    notes = action_ops.ensure_item_def(model, (file, package), item["type"])
    model.ensure_def_import(package, model.item_defs, item["type"])
    port.setdefault("items", []).append(item)
    return notes + [
        f"Port {ident(port)} now carries {item['direction']} item "
        f"{item['name']} : {item['type']}."
    ]


def add_line_item(model: Model, performer: Performer, item: dict) -> list[str]:
    """The row's action def gets the line's item (if it is new)."""
    if not item.pop("new", False):
        return []
    action_ops.add_action_item(model, performer.action_name, item)
    return [
        f"{performer.action_name} now {gets_or_gives(item)} "
        f"{item['name']} : {item['type']}."
    ]


def gets_or_gives(item: dict) -> str:
    if item["direction"] == INGRESS:
        return "gets"
    return "gives"


def unlink(action: dict, ref: str) -> None:
    """Remove the composed action def's flows and bindings to `ref`."""
    action_ops.remove_matching(
        action, "flows", lambda flow: ref in (flow["from"], flow["to"])
    )
    action_ops.remove_matching(
        action, "bindings", lambda binding: ref in binding["ends"]
    )
    action_ops.drop_if_empty(action, "flows")
    action_ops.drop_if_empty(action, "bindings")


# ---------------------------------------------------------------- the links


def link_actions(model: Model, sheet: str, perform: str) -> Result:
    """Work out the links of every line that has none (after wires change)."""
    found = action_ops.performance(model, sheet, perform)
    return Result([], work_out_links(model, found))


def work_out_links(model: Model, found) -> list[str]:
    """Link every ingress without a link to what feeds it over a wire, and
    every egress wired to the sheet's own port to the composed action's own
    item. Returns the notes to show."""
    placed = placed_actions(model, found)
    notes = []
    for action in placed:
        for line in action.lines_of(INGRESS):
            notes += link_ingress(model, (found, placed), action, line)
        for line in action.lines_of(EGRESS):
            notes += link_egress_to_sheet(model, found, line)
    return notes


def placed_actions(model: Model, found) -> list[Placed]:
    """The composed action def's actions in order, each with its lines."""
    placed = []
    for index, step in enumerate(found.action.get("actions", [])):
        made = Placed(index, step["name"])
        part = allocated_part(found.owner, found.step_ref(step["name"]))
        if part is not None:
            made.lines = lines_of(model, step, part)
        placed.append(made)
    return placed


def lines_of(model: Model, step: dict, part: dict) -> list[Line]:
    """A placed action's items, and the port of its part each one uses."""
    owner = model.part_def(short(part["type"]))[2]
    perform = action_ops.perform_of(owner, step["type"])
    if perform is None:
        return []
    action = action_ops.action_def(model, step["type"])[2]
    return [
        line_of(step, (part, owner, perform), item)
        for item in action.get("parameters", [])
    ]


def line_of(step: dict, performer: tuple, item: dict) -> Line:
    part, owner, perform = performer
    ref = f"{step['name']}.{item['name']}"
    port_end = port_end_for(
        owner, f"{perform['name']}.{item['name']}", item["direction"]
    )
    if not port_end:
        return Line(ref, item, None)
    port, _, port_item = port_end.partition(".")
    return Line(ref, item, (part["name"], port), port_item)


def is_linked(action: dict, ref: str) -> bool:
    flows = action.get("flows", [])
    bindings = action.get("bindings", [])
    return any(flow["to"] == ref for flow in flows) or any(
        ref in binding["ends"] for binding in bindings
    )


def link_ingress(model: Model, where: tuple, action: Placed, line: Line) -> list[str]:
    """Feed an ingress from the latest earlier egress over a wire, else from
    the sheet's own port; nothing if neither is wired to it."""
    found, placed = where
    if line.end is None or is_linked(found.action, line.ref):
        return []
    feeders = feeders_of(found.owner, placed[: action.index], line)
    if feeders:
        return link_from_action(found, feeders, line)
    sheet_port = sheet_port_wired_to(found.owner, line.end)
    if sheet_port is None:
        return []
    return link_to_sheet(model, (found, sheet_port), line)


def feeders_of(sheet: dict, earlier: list[Placed], line: Line) -> list[Line]:
    """The egress lines of earlier actions that can feed `line`: the same
    item def, on a port wired to its port. The latest action's first."""
    feeders = []
    for action in reversed(earlier):
        for egress in action.lines_of(EGRESS):
            if can_feed(sheet, egress, line):
                feeders.append(egress)
    return feeders


def can_feed(sheet: dict, egress: Line, ingress: Line) -> bool:
    if egress.end is None:
        return False
    if short(egress.item["type"]) != short(ingress.item["type"]):
        return False
    return has_wire(sheet, egress.end, ingress.end)


def link_from_action(found, feeders: list[Line], line: Line) -> list[str]:
    """`succession flow from feeder to line;`: the latest feeder."""
    feeder = feeders[0]
    action_ops.add_item_link(found.action, feeder.ref, line.ref)
    note = f"{line.ref} gets {feeder.ref} (over the wire to {end_text(line.end)})."
    if len(feeders) > 1:
        others = ", ".join(other.ref for other in feeders[1:])
        note += f" It could also get {others}: the latest is taken."
    return [note]


def link_egress_to_sheet(model: Model, found, line: Line) -> list[str]:
    """An egress on a port wired to the sheet's own port leaves the composed
    action: bound to its own item of the same item def."""
    if line.end is None or is_linked(found.action, line.ref):
        return []
    sheet_port = sheet_port_wired_to(found.owner, line.end)
    if sheet_port is None:
        return []
    return link_to_sheet(model, (found, sheet_port), line)


def sheet_port_wired_to(sheet: dict, end: tuple) -> str | None:
    """The sheet's own port wired to `end` (part, port), if any."""
    wanted = end_text(end)
    for wire in sheet.get("connections", []) + sheet.get("bindings", []):
        if wanted not in wire["ends"]:
            continue
        other = next(text for text in wire["ends"] if text != wanted)
        if "." not in other:
            return other
    return None


def link_to_sheet(model: Model, where: tuple, line: Line) -> list[str]:
    """`bind line = own;`: the composed action def's own item that enters
    or leaves by the sheet's port, made if it has none."""
    found, sheet_port = where
    own, notes = own_item_by(model, (found, sheet_port), line)
    source, target = link_ends(line, own)
    action_ops.add_item_link(found.action, source, target)
    notes.append(f"{line.ref} is {found.action['name']}'s {own} (by {sheet_port}).")
    return notes


def link_ends(line: Line, own: str) -> tuple[str, str]:
    """(source, target): an ingress gets the own item; an egress gives to it."""
    if line.item["direction"] == INGRESS:
        return own, line.ref
    return line.ref, own


def own_item_by(model: Model, where: tuple, line: Line) -> tuple[str, list[str]]:
    """The composed action def's own item of the item def and direction of
    the line's item that uses the sheet's port, else a new one named after
    the item the line's port carries."""
    found, sheet_port = where
    item = line.item
    for own in found.action.get("parameters", []):
        if is_own_item_by(found, own, (item, sheet_port)):
            return own["name"], []
    name = unique_parameter_name(found.action, line.port_item or item["name"])
    new = {"name": name, "direction": item["direction"], "type": item["type"]}
    notes = action_ops.add_action_item(model, found.action["name"], new).notes
    via = {"item": name, "port": sheet_port}
    notes += action_ops.set_item_port(
        model, found.owner["name"], found.perform["name"], via
    ).notes
    notes.append(f"{found.action['name']} now {gets_or_gives(new)} {name}.")
    return name, notes


def is_own_item_by(found, own: dict, wanted: tuple) -> bool:
    item, sheet_port = wanted
    if own["direction"] != item["direction"]:
        return False
    if short(own["type"]) != short(item["type"]):
        return False
    ref = f"{found.perform['name']}.{own['name']}"
    port_end = port_end_for(found.owner, ref, own["direction"])
    return port_end is not None and port_end.split(".")[0] == sheet_port


def unique_parameter_name(action: dict, base: str) -> str:
    taken = {parameter["name"] for parameter in action.get("parameters", [])}
    name, number = base, 2
    while name in taken:
        name, number = f"{base}_{number}", number + 1
    return name


def end_text(end: tuple) -> str:
    part, port = end
    return f"{part}.{port}"


# ---------------------------------------------------------------- port items


def delete_port_item(model: Model, def_name: str, port_item: str) -> Result:
    """The port no longer carries the item (`port_item` is "port.item"); the
    part def's flows to it go too."""
    port_name, _, item_name = port_item.partition(".")
    _, _, owner, port = _port(model, def_name, port_name)
    declared = next(
        (item for item in port.get("items", []) if item["name"] == item_name), None
    )
    if declared is None:
        raise OpError("not_found", f"port {port_name} has no item {item_name}")
    port["items"].remove(declared)
    action_ops.drop_if_empty(port, "items")
    removed = action_ops.remove_matching(
        owner, "flows", lambda flow: port_item in (flow["from"], flow["to"])
    )
    action_ops.drop_if_empty(owner, "flows")
    if not removed:
        return Result([])
    return Result([], [f"Removed {removed} flow(s) to {port_item}."])


# ---------------------------------------------------------------- the table


# name -> (call, required arguments, optional arguments), as ops.OPERATIONS.
LINK_OPERATIONS = {
    "set_action_end": (
        lambda m, a: set_action_end(
            m,
            Row(a["sheet"], a["perform"], a["step"]),
            ActionEnd(
                a["direction"],
                a.get("item"),
                a.get("port"),
                a.get("portItem"),
                a.get("newPortItem"),
                a.get("replaces"),
            ),
        ),
        ["sheet", "perform", "step", "direction"],
        ["item", "port", "portItem", "newPortItem", "replaces"],
    ),
    "delete_port_item": (
        lambda m, a: delete_port_item(m, a["def"], a["item"]),
        ["def", "item"],
        [],
    ),
    "link_actions": (
        lambda m, a: link_actions(m, a["sheet"], a["perform"]),
        ["sheet", "perform"],
        [],
    ),
}

LINK_OPERATIONS = {
    name: (action_ops.tracked(call), required, optional)
    for name, (call, required, optional) in LINK_OPERATIONS.items()
}
