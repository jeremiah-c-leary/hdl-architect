"""The walk of HA 2: building a composite action def by following the data
through the sheet (decided with the user, 2026-11-27).

The user clicks the sheet's own port the request comes in by; its wire leads
to a part. At that part they pick one of the action defs it performs that
come in by that port, and one of that action def's exits (the port an item
leaves by, as the part def says: `flow from receiveFrame.int to
Interrupt.int;`). That is one step of the walk: the composite action def
gets an action of that action def, performed by the part, fed by what came
before (the sheet's own port, or the previous action's exit). The exit's
wire leads to the next part, and so on until an exit leads back to a sheet
port.

(The table's operations, set_action_end and set_hop, set one line or one hop
at a time; this adds a whole action whose lines the part def already says.)
"""

from __future__ import annotations

from dataclasses import dataclass

from hdl_architect.core import action_ops
from hdl_architect.core.action_hops import end_text, unique_step_name
from hdl_architect.core.action_links import (
    EGRESS,
    INGRESS,
    link_to_sheet,
    placed_actions,
    sheet_port_wired_to,
)
from hdl_architect.core.actions import allocated_part, has_wire
from hdl_architect.core.ops import Model, OpError, Result


@dataclass
class Walk:
    """One step of a walk.

    - came_from: (step, port): the action before and its exit port, or
      (None, port): the sheet's own port the walk starts at;
    - at: (part, port): where it arrives, over the wire from `came_from`;
    - action: the action def the part performs there;
    - exit: the port of the part it leaves by; None: it leaves by none.
    """

    sheet: str
    perform: str
    came_from: tuple
    at: tuple
    action: str
    exit: str | None = None


def walk_step(model: Model, walk: Walk) -> Result:
    """Add the action the part performs where the walk arrives, fed by what
    came before; if its exit leads to the sheet's own port, it leaves there."""
    found = action_ops.performance(model, walk.sheet, walk.perform)
    check_wired(found, walk)
    name = unique_step_name(found.action, walk.action)
    step = {"name": name, "part": walk.at[0], "action": walk.action}
    notes = action_ops.add_step(model, walk.sheet, walk.perform, step).notes
    ingress = line_via(model, found, (name, INGRESS, walk.at[1]))
    notes += feed(model, found, (walk.came_from, ingress))
    if walk.exit is not None:
        egress = line_via(model, found, (name, EGRESS, walk.exit))
        notes += leave_to_sheet(model, found, egress)
    return Result([], notes, {"step": name})


def check_wired(found, walk: Walk) -> None:
    """The walk arrives over a wire from where it came from."""
    source = source_end(found, walk.came_from)
    if not has_wire(found.owner, source, walk.at):
        raise OpError(
            "no_wire", f"no wire from {end_text(source)} to {end_text(walk.at)}"
        )


def source_end(found, came_from: tuple) -> tuple:
    """(part, port) the walk comes from; (None, port) for the sheet's own."""
    step, port = came_from
    if step is None:
        return (None, port)
    part = allocated_part(found.owner, found.step_ref(step))
    if part is None:
        raise OpError("not_allocated", f"{step} is not performed by a part yet")
    return (part["name"], port)


def line_via(model: Model, found, wanted: tuple):
    """The line of an action that goes in or out by a port."""
    step, direction, port = wanted
    for placed in placed_actions(model, found):
        if placed.name != step:
            continue
        for line in placed.lines_of(direction):
            if line.end is not None and line.end[1] == port:
                return line
    way = "comes in" if direction == INGRESS else "goes out"
    raise OpError("no_line", f"{step} has no item that {way} by {port}")


def feed(model: Model, found, where: tuple) -> list[str]:
    """`bind ingress = own;` from the sheet's own port, else `succession
    flow from previous exit to ingress;`."""
    came_from, ingress = where
    step, port = came_from
    if step is None:
        return link_to_sheet(model, (found, port), ingress)
    exit_line = line_via(model, found, (step, EGRESS, port))
    action_ops.add_item_link(found.action, exit_line.ref, ingress.ref)
    return [f"{ingress.ref} gets {exit_line.ref}."]


def leave_to_sheet(model: Model, found, egress) -> list[str]:
    """An exit wired to the sheet's own port: the walk ends there."""
    sheet_port = sheet_port_wired_to(found.owner, egress.end)
    if sheet_port is None:
        return []
    return link_to_sheet(model, (found, sheet_port), egress)


# ---------------------------------------------------------------- the table


def walk_of(args: dict) -> Walk:
    """A walk step as the browser sends it."""
    came_from, at = args["from"], args["at"]
    if not isinstance(came_from, dict) or not isinstance(at, dict):
        raise OpError("bad_request", "from is {step, port}; at is {part, port}")
    return Walk(
        args["sheet"],
        args["perform"],
        (came_from.get("step"), came_from.get("port")),
        (at.get("part"), at.get("port")),
        args["action"],
        args.get("exit"),
    )


# name -> (call, required arguments, optional arguments), as ops.OPERATIONS.
WALK_OPERATIONS = {
    "walk_step": (
        action_ops.tracked(lambda m, a: walk_step(m, walk_of(a))),
        ["sheet", "perform", "from", "at", "action"],
        ["exit"],
    ),
}
