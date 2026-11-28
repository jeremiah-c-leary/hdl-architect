"""The address map's operations (decision 14), for HA 2's Memory map root…
and Memory map windows… dialogs, and its "Crossbar" switch on a part def.

- set_root: mark a manager port as a memory map's root (its name, and the
  address its manager sees the map at), or unmark it. It is on the part
  def's port, so every instance of the part def is a root.
- set_windows: set (or clear) the address windows on a sheet's connections
  from a crossbar's manager ports; several at once, as the dialog saves.
- set_crossbar: say a part def is a crossbar (it specializes Crossbar as
  well as its kind), or is not.

The model shapes are in core/addresses.py; the core checks the map as a
whole (overlaps, ...). These refuse only what could never be right.
"""

from __future__ import annotations

import re

from hdl_architect.core.addresses import CROSSBAR_DEF, MANAGER, ROOT, WINDOW
from hdl_architect.core.ops import (
    KINDS,
    Model,
    OpError,
    Result,
    _port,
    short,
)

ROOT_ATTRIBUTE = "root"
WINDOW_ATTRIBUTE = "window"

# A map's name becomes a SystemRDL addrmap name: an identifier.
MAP_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")


# ---------------------------------------------------------------- roots


def set_root(model: Model, def_name: str, port: str, name: str | None, base) -> Result:
    """Mark port `def_name.port` as the root of memory map `name`, seen at
    `base`; no name removes the mark."""
    file, pkg, _, usage = _port(model, def_name, port)
    if not name:
        remove_attribute(usage, ROOT)
        return Result({file})
    check_map_name(name)
    check_address("base", base)
    if not is_manager_port(model, usage):
        raise OpError(
            "not_manager",
            f"{def_name}.{port} is not the manager port of a memory-mapped bus "
            f"(its port def does not specialize {MANAGER})",
        )
    values = {"map_name": name, "base": base}
    put_attribute(usage, ROOT_ATTRIBUTE, ROOT, values)
    model.ensure_attribute_import(pkg, ROOT)
    return Result({file})


def check_map_name(name) -> None:
    if not isinstance(name, str) or not MAP_NAME_RE.match(name):
        raise OpError(
            "bad_name",
            f"{name!r} is not a legal memory map name: a letter, then letters, "
            "digits and underscores",
        )


def is_manager_port(model: Model, usage: dict) -> bool:
    """A port on a memory-mapped bus, on the manager side (as
    addresses.port_role says, over the editor's model)."""
    if not usage.get("type"):
        return False
    name = short(usage["type"])
    conjugated = bool(usage.get("conjugated"))
    entry = model.port_defs.get(name)
    if entry is not None and entry[2].get("conjugateOf"):
        name = short(entry[2]["conjugateOf"])
        conjugated = not conjugated
    return not conjugated and MANAGER in port_generals(model, name)


def port_generals(model: Model, name: str) -> set[str]:
    found: set[str] = set()
    pending = [name]
    while pending:
        current = pending.pop()
        entry = model.port_defs.get(current)
        if current in found or entry is None:
            continue
        found.add(current)
        pending += [short(n) for n in entry[2].get("specializes", [])]
    return found


# ---------------------------------------------------------------- windows


def set_windows(model: Model, sheet: str, windows: list) -> Result:
    """Each of `windows` is {ends: [a, b], base, size}: the window on the
    connection between a and b on part def `sheet`. No base clears it."""
    file, pkg, owner = model.part_def(sheet)
    for window in windows:
        connection = find_connection(owner, window.get("ends"), sheet)
        set_window(connection, window.get("base"), window.get("size"))
    model.ensure_attribute_import(pkg, WINDOW)
    return Result({file})


def find_connection(owner: dict, ends, sheet: str) -> dict:
    if not isinstance(ends, list) or len(ends) != 2:
        raise OpError("bad_request", "a window names its connection's two ends")
    for connection in owner.get("connections", []):
        if sorted(connection["ends"]) == sorted(ends):
            return connection
    raise OpError("not_found", f"{sheet} has no connection {ends[0]} to {ends[1]}")


def set_window(connection: dict, base, size) -> None:
    if base is None:
        remove_attribute(connection, WINDOW)
        return
    check_address("base", base)
    check_address("size", size)
    if size == 0:
        raise OpError("bad_value", "a window's size must be more than 0")
    put_attribute(connection, WINDOW_ATTRIBUTE, WINDOW, {"base": base, "size": size})


# ---------------------------------------------------------------- crossbars


def set_crossbar(model: Model, def_name: str, is_crossbar: bool) -> Result:
    """Make a part def a crossbar (`:> Kind, Crossbar`), or not. The kind
    stays first: it says who owns the HDL."""
    file, pkg, definition = model.part_def(def_name)
    if CROSSBAR_DEF not in model.part_defs:
        raise OpError(
            "not_found", f"no part def {CROSSBAR_DEF} in the model (FpgaLib has one)"
        )
    generals = definition.get("specializes", [])
    rest = [g for g in generals if short(g) != CROSSBAR_DEF]
    if is_crossbar:
        kinds = [g for g in rest if short(g) in KINDS]
        others = [g for g in rest if short(g) not in KINDS]
        rest = kinds + [CROSSBAR_DEF] + others
        model.ensure_part_import(pkg, CROSSBAR_DEF)
    definition["specializes"] = rest
    if not rest:
        del definition["specializes"]
    return Result({file})


# ---------------------------------------------------------------- attributes


def put_attribute(element: dict, name: str, type_name: str, values: dict) -> None:
    """Set the element's attribute of type `type_name` (replacing it)."""
    made = {"name": name, "type": type_name, "redefines": values}
    attributes = element.setdefault("attributes", [])
    for index, attribute in enumerate(attributes):
        if short(attribute["type"]) == type_name:
            attributes[index] = made
            return
    attributes.append(made)


def remove_attribute(element: dict, type_name: str) -> None:
    kept = [a for a in element.get("attributes", []) if short(a["type"]) != type_name]
    if kept:
        element["attributes"] = kept
    else:
        element.pop("attributes", None)


def check_address(what: str, value) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise OpError("bad_value", f"{what} must be a whole number, 0 or more")


ADDRESS_OPERATIONS = {
    "set_root": (
        lambda m, a: set_root(m, a["def"], a["port"], a.get("name"), a.get("base")),
        ["def", "port"],
        ["name", "base"],
    ),
    "set_windows": (
        lambda m, a: set_windows(m, a["sheet"], a["windows"]),
        ["sheet", "windows"],
        [],
    ),
    "set_crossbar": (
        lambda m, a: set_crossbar(m, a["def"], bool(a["crossbar"])),
        ["def", "crossbar"],
        [],
    ),
}
