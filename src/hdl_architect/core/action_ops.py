"""Operations on performed actions: what a part def does, its steps, who
performs each step, and which port each item uses. (The walk that reads
them, with the statuses and the missing-wire checks, is core/actions.py.)

Where things live in the model (examples/wifi_router shows it):

- A part def performs an action def: `performs` on the part def.
- A composed action def has steps (`actions`), each typed by an action def;
  the items between steps are `flows` of the action def, and its own items
  are `bindings` (`bind receiveFrame.ethFrame = cmdFrame;`).
- The sheet (the part def that performs the composed action) allocates each
  step to one of its parts: `allocations`, `readTemperature.readSensor` to
  `temp_if`. That part's def must perform the step's action def.
- Which port an item of a performed action uses is a flow on the part def,
  between the port's own item and the action's item:
  `flow from temp_read.request to readSensor.request;`.

The rules, decided with the user (HANDOFF decision 13):

- Top-down: a step given to a part that does not perform its action def yet
  makes that part's def perform it ("it becomes an action that part must
  perform"). A new action def goes in the package of the part def that
  performs it, so a subsystem's actions live with the subsystem.
- IP brings its own: a step given to IP (VendorIp, HardMacro) must use an
  action the IP already performs; nothing is added to the IP.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from hdl_architect.core.ops import (
    NAME_RE,
    Model,
    OpError,
    Result,
    _part_generals,
    _port,
    ident,
    pascal,
    short,
)

# Part kinds that are IP: they bring their own performed actions.
IP_KINDS = {"VendorIp", "HardMacro"}
DIRECTIONS = ("in", "out")


@dataclass
class Performance:
    """A part def's perform of an action def, and that action def."""

    file: str  # the part def's file
    package: dict
    owner: dict  # the part def
    perform: dict
    action_file: str
    action_package: dict
    action: dict  # the action def

    def step_ref(self, step: str) -> str:
        """How the part def's allocations name a step: `perform.step`."""
        return f"{self.perform['name']}.{step}"


# ---------------------------------------------------------------- lookups


def action_def(model: Model, name: str) -> tuple[str, dict, dict]:
    entry = model.action_defs.get(short(name))
    if entry is None:
        raise OpError("not_found", f"no action def {name}")
    return entry


def find_perform(owner: dict, name: str) -> dict:
    for perform in owner.get("performs", []):
        if perform["name"] == name:
            return perform
    raise OpError("not_found", f"{owner['name']} does not perform {name}")


def performance(model: Model, def_name: str, perform_name: str) -> Performance:
    file, package, owner = model.part_def(def_name)
    perform = find_perform(owner, perform_name)
    action_file, action_package, action = action_def(model, perform["type"])
    return Performance(
        file, package, owner, perform, action_file, action_package, action
    )


def find_step(action: dict, name: str) -> dict:
    for step in action.get("actions", []):
        if step["name"] == name:
            return step
    raise OpError("not_found", f"{action['name']} has no step {name}")


def find_part(owner: dict, name: str) -> dict:
    for part in owner.get("parts", []):
        if part["name"] == name:
            return part
    raise OpError("not_found", f"{owner['name']} has no part {name}")


def find_parameter(action: dict, name: str) -> dict:
    for parameter in action.get("parameters", []):
        if parameter["name"] == name:
            return parameter
    raise OpError("not_found", f"{action['name']} has no item {name}")


def perform_of(owner: dict, action_name: str) -> dict | None:
    """The part def's perform of an action def, if it has one."""
    for perform in owner.get("performs", []):
        if short(perform["type"]) == short(action_name):
            return perform
    return None


def is_ip(model: Model, def_name: str) -> bool:
    return bool(IP_KINDS & _part_generals(model, def_name))


def lower_first(name: str) -> str:
    """`ReadSensor` -> `readSensor` (a usage named after its definition)."""
    return name[:1].lower() + name[1:]


def check_name(name: str, what: str) -> None:
    if not isinstance(name, str) or not NAME_RE.match(name):
        raise OpError(
            "bad_name",
            f'"{name}" is not a legal {what} name: a letter, then letters, '
            "digits and single underscores.",
        )


def drop_if_empty(owner: dict, key: str) -> None:
    if key in owner and not owner[key]:
        del owner[key]


def names_step(end: str, step: str) -> bool:
    """Whether a flow or binding end (`step.item`) is on `step`."""
    return end.split(".")[0] == step


# ---------------------------------------------------------------- action defs


def new_action_def(model: Model, def_name: str, action_name: str) -> list[str]:
    """Make action def `action_name` in the package of part def `def_name`,
    the part that will perform it. Returns the note to show."""
    check_name(action_name, "action def")
    if action_name in model.action_defs:
        raise OpError("exists", f"there is already an action def {action_name}")
    file, package, _ = model.part_def(def_name)
    package.setdefault("actionDefs", []).append({"name": action_name})
    model.action_defs[action_name] = (file, package, package["actionDefs"][-1])
    where = model.package_name[id(package)]
    return [f"New action def {action_name} in package {where}."]


def action_for(model: Model, performer: str, action_name: str) -> list[str]:
    """Make sure action def `action_name` exists for part def `performer` to
    perform: an existing one, else a new one in its package (not for IP).
    Returns the notes to show."""
    if short(action_name) in model.action_defs:
        return []
    if is_ip(model, performer):
        raise OpError(
            "ip_actions",
            f"{performer} is IP: it brings its own actions. Use one it performs "
            f"({performed_names(model, performer)}), or add {action_name} to the "
            "IP's own model first.",
        )
    return new_action_def(model, performer, action_name)


def performed_names(model: Model, def_name: str) -> str:
    performs = model.part_def(def_name)[2].get("performs", [])
    return ", ".join(short(p["type"]) for p in performs) or "none yet"


def ensure_performs(model: Model, def_name: str, action_name: str) -> list[str]:
    """Top-down: part def `def_name` performs action def `action_name`, added
    if it does not yet (refused for IP). Returns the notes to show."""
    _, package, owner = model.part_def(def_name)
    if perform_of(owner, action_name):
        return []
    if is_ip(model, def_name):
        raise OpError(
            "ip_actions",
            f"{def_name} is IP and does not perform {action_name}: use one of "
            f"its actions ({performed_names(model, def_name)}).",
        )
    name = unique_perform_name(owner, lower_first(short(action_name)))
    owner.setdefault("performs", []).append({"name": name, "type": short(action_name)})
    model.ensure_def_import(package, model.action_defs, action_name)
    return [f"{def_name} now performs {name} : {short(action_name)}."]


def unique_perform_name(owner: dict, base: str) -> str:
    taken = {perform["name"] for perform in owner.get("performs", [])}
    name, number = base, 2
    while name in taken:
        name, number = f"{base}_{number}", number + 1
    return name


# ---------------------------------------------------------------- performs


def add_perform(
    model: Model, def_name: str, action: str, name: str | None = None
) -> Result:
    """Part def `def_name` performs action def `action` (made in its package
    if there is none by that name; for IP too, as this is how its own model
    says what it performs). The perform is named
    `name`, or after the action def (`ReadSensor` -> `readSensor`)."""
    file, package, owner = model.part_def(def_name)
    if perform_of(owner, action):
        raise OpError("exists", f"{def_name} already performs {action}")
    name = name or lower_first(short(action))
    check_name(name, "perform")
    if any(perform["name"] == name for perform in owner.get("performs", [])):
        raise OpError("exists", f"{def_name} already performs an action {name}")
    notes = []
    if short(action) not in model.action_defs:  # IP too: this models the IP itself
        notes = new_action_def(model, def_name, action)
    owner.setdefault("performs", []).append({"name": name, "type": short(action)})
    model.ensure_def_import(package, model.action_defs, action)
    return Result([], notes, data={"name": name})


def delete_perform(model: Model, def_name: str, perform: str) -> Result:
    """The part def no longer performs it: the perform goes, with its flows
    (which ports its items use) and its steps' allocations. The action def
    stays."""
    file, _, owner = model.part_def(def_name)
    owner["performs"].remove(find_perform(owner, perform))
    drop_if_empty(owner, "performs")
    flows = remove_matching(owner, "flows", lambda flow: on_perform(flow, perform))
    allocations = remove_matching(
        owner,
        "allocations",
        lambda allocation: allocation["from"].startswith(f"{perform}."),
    )
    notes = []
    if flows:
        notes.append(f"Removed {flows} flow(s): which ports {perform}'s items use.")
    if allocations:
        notes.append(f"Removed {allocations} allocation(s) of {perform}'s steps.")
    return Result([], notes)


def on_perform(flow: dict, perform: str) -> bool:
    return perform in (flow["from"].split(".")[0], flow["to"].split(".")[0])


def remove_matching(owner: dict, key: str, matches) -> int:
    """Remove the entries of owner[key] that match; returns how many."""
    entries = owner.get(key, [])
    kept = [entry for entry in entries if not matches(entry)]
    removed = len(entries) - len(kept)
    if removed:
        owner[key] = kept
        drop_if_empty(owner, key)
    return removed


# ---------------------------------------------------------------- steps


def add_step(
    model: Model,
    sheet: str,
    perform: str,
    step: dict,
) -> Result:
    """Add a step to the action that `sheet` performs as `perform`, performed
    by one of the sheet's parts. `step` is {"name", "part", "action"?}: its
    action def is `action`, or one named after the step (`decodeCommand` ->
    `DecodeCommand`), made in the part's package if there is none."""
    found = performance(model, sheet, perform)
    name = step["name"]
    check_name(name, "step")
    if any(s["name"] == name for s in found.action.get("actions", [])):
        raise OpError("exists", f"{found.action['name']} already has a step {name}")
    performer = short(find_part(found.owner, step["part"])["type"])
    action_name = step.get("action") or pascal(name)
    notes = action_for(model, performer, action_name)
    notes += ensure_performs(model, performer, action_name)
    found.action.setdefault("actions", []).append(
        {"name": name, "type": short(action_name)}
    )
    model.ensure_def_import(found.action_package, model.action_defs, action_name)
    allocate(found, name, step["part"])
    return Result([], notes)


def allocate(found: Performance, step: str, part: str) -> None:
    """`allocate perform.step to part;` on the sheet, replacing any other."""
    ref = found.step_ref(step)
    remove_matching(found.owner, "allocations", lambda a: a["from"] == ref)
    found.owner.setdefault("allocations", []).append({"from": ref, "to": part})


def set_step_part(
    model: Model, sheet: str, perform: str, step: str, part: str
) -> Result:
    """Another part of the sheet performs the step; its def is made to
    perform the step's action def if it does not yet (not IP)."""
    found = performance(model, sheet, perform)
    action_name = find_step(found.action, step)["type"]
    performer = short(find_part(found.owner, part)["type"])
    notes = ensure_performs(model, performer, action_name)
    allocate(found, step, part)
    return Result([], notes)


def set_step_action(
    model: Model, sheet: str, perform: str, step: str, action: str
) -> Result:
    """The step is another action def: an existing one, or a new one in its
    performer's package. Flows to items the new def does not have go."""
    found = performance(model, sheet, perform)
    the_step = find_step(found.action, step)
    performer = step_performer(found, step)
    notes = action_for(model, performer or sheet, action)
    if performer:
        notes += ensure_performs(model, performer, action)
    the_step["type"] = short(action)
    model.ensure_def_import(found.action_package, model.action_defs, action)
    kept = {p["name"] for p in action_def(model, action)[2].get("parameters", [])}
    notes += remove_step_ends(found.action, step, kept)
    return Result([], notes)


def step_performer(found: Performance, step: str) -> str | None:
    """The def of the part the step is allocated to, if any."""
    ref = found.step_ref(step)
    for allocation in found.owner.get("allocations", []):
        if allocation["from"] == ref:
            return short(find_part(found.owner, allocation["to"])["type"])
    return None


def remove_step_ends(action: dict, step: str, kept: set[str]) -> list[str]:
    """Remove the action def's flows and bindings to items of `step` that are
    not in `kept` (all of them, when kept is empty). Returns the notes."""

    def gone(end: str) -> bool:
        name, _, item = end.partition(".")
        return name == step and item not in kept

    flows = remove_matching(
        action, "flows", lambda flow: gone(flow["from"]) or gone(flow["to"])
    )
    bindings = remove_matching(
        action, "bindings", lambda binding: any(gone(e) for e in binding["ends"])
    )
    if not flows + bindings:
        return []
    return [f"Removed {flows + bindings} flow(s) and binding(s) to {step}'s items."]


def delete_step(model: Model, sheet: str, perform: str, step: str) -> Result:
    """Delete a step from the action def: its flows and bindings, and its
    allocation on every part def that performs the action."""
    found = performance(model, sheet, perform)
    found.action["actions"].remove(find_step(found.action, step))
    drop_if_empty(found.action, "actions")
    notes = remove_step_ends(found.action, step, set())
    for _, owner, its_perform in performers_of(model, found.action["name"]):
        ref = f"{its_perform['name']}.{step}"
        remove_matching(owner, "allocations", lambda a: a["from"] == ref)
    return Result([], notes)


def performers_of(model: Model, action_name: str):
    """(file, part def, perform) for every part def that performs the action def."""
    for file, _, owner in model.part_defs.values():
        for perform in owner.get("performs", []):
            if short(perform["type"]) == action_name:
                yield file, owner, perform


def move_step(model: Model, sheet: str, perform: str, step: str, index: int) -> Result:
    """Move a step to position `index` (0 first) in its action def's steps."""
    found = performance(model, sheet, perform)
    steps = found.action["actions"]
    the_step = find_step(found.action, step)
    if not isinstance(index, int) or not 0 <= index < len(steps):
        raise OpError("bad_request", f"index must be 0 to {len(steps) - 1}")
    steps.remove(the_step)
    steps.insert(index, the_step)
    return Result([])


# ---------------------------------------------------------------- an action's items


def add_action_item(model: Model, action: str, item: dict) -> Result:
    """Give an action def an item it gets (`in`) or gives (`out`): `item` is
    {"name", "direction", "type"?}; the item def is made in the action def's
    package if there is none. No type: an item whose item def is not chosen
    yet (`in item name;`)."""
    file, package, definition = action_def(model, action)
    name, direction, type_ = item["name"], item["direction"], item.get("type")
    check_name(name, "item")
    if direction not in DIRECTIONS:
        raise OpError("bad_request", 'direction must be "in" or "out"')
    if any(p["name"] == name for p in definition.get("parameters", [])):
        raise OpError("exists", f"{action} already has an item {name}")
    notes = []
    if type_:
        notes = ensure_item_def(model, (file, package), type_)
        model.ensure_def_import(package, model.item_defs, type_)
    parameter = with_type({"name": name, "direction": direction}, type_)
    definition.setdefault("parameters", []).append(parameter)
    return Result([], notes)


def with_type(item: dict, type_: str | None) -> dict:
    """The item with its item def, if it has one (else none is written)."""
    if type_:
        item["type"] = short(type_)
    return item


def type_of(item: dict) -> str | None:
    """An item's item def (unqualified); None while it has none."""
    return short(item.get("type"))


def ensure_item_def(model: Model, where: tuple[str, dict], type_: str) -> list[str]:
    """Make item def `type_` in package `where` (file, package) if there is
    none by that name. Returns the notes to show."""
    if short(type_) in model.item_defs:
        return []
    check_name(short(type_), "item def")
    file, package = where
    package.setdefault("itemDefs", []).append({"name": short(type_)})
    model.item_defs[short(type_)] = (file, package, package["itemDefs"][-1])
    where = model.package_name[id(package)]
    return [f"New item def {short(type_)} in package {where}."]


def delete_action_item(model: Model, action: str, item: str) -> Result:
    """Delete an action def's item, and everything that refers to it: its
    bindings in the action def, the flows to it where the action is a step,
    and the flows that say which port it uses where the action is performed."""
    file, _, definition = action_def(model, action)
    definition["parameters"].remove(find_parameter(definition, item))
    drop_if_empty(definition, "parameters")
    removed = remove_matching(
        definition, "bindings", lambda binding: item in binding["ends"]
    )
    for where, owner, usage in users_of(model, action):
        ref = f"{usage}.{item}"
        removed += remove_matching(owner, where, lambda e: ref in flow_ends(e))
    notes = [f"Removed what referred to {item}: {removed} flow(s) or binding(s)."]
    return Result([], notes if removed else [])


def users_of(model: Model, action: str):
    """Where action def `action` is used, and so where its items are named:
    (key, owner, usage name) for the flows and bindings of each composed
    action def with a step of it, and the flows of each part def performing it."""
    for _, _, composed in model.action_defs.values():
        for step in composed.get("actions", []):
            if short(step.get("type")) == short(action):
                yield "flows", composed, step["name"]
                yield "bindings", composed, step["name"]
    for _, owner, perform in performers_of(model, short(action)):
        yield "flows", owner, perform["name"]


def flow_ends(entry: dict) -> list[str]:
    """A flow's two ends, or a binding's."""
    return entry.get("ends") or [entry["from"], entry["to"]]


def connect_items(model: Model, action: str, source: str, target: str) -> Result:
    """An item passes from `source` to `target` inside a composed action def.
    Between two steps (`receiveFrame.cmd` to `decodeCommand.cmd`) it is a
    flow, the second step starting after the first. From the action's own
    item into a step (`cmdFrame` to `receiveFrame.ethFrame`), or from a
    step out to it, it is a binding: they are the same item."""
    file, _, definition = action_def(model, action)
    source_item = end_item(model, definition, source)
    target_item = end_item(model, definition, target)
    check_flow_direction(source, source_item, target, target_item)
    if type_of(source_item) != type_of(target_item):
        raise OpError(
            "types",
            f"{source} is {type_of(source_item)} but {target} is "
            f"{type_of(target_item)}",
        )
    add_item_link(definition, source, target)
    return Result([])


def end_item(model: Model, definition: dict, end: str) -> dict:
    """The item an end names: `step.item` (the step's action def's), or one
    of the action def's own items."""
    step_name, dot, item = end.partition(".")
    if not dot:
        return find_parameter(definition, end)
    step = find_step(definition, step_name)
    return find_parameter(action_def(model, step["type"])[2], item)


def check_flow_direction(
    source: str, source_item: dict, target: str, target_item: dict
) -> None:
    """A step's item flows out of it if it gives it (`out`); the action's own
    item flows in to the steps if the action gets it (`in`). And the reverse
    for a target."""
    if is_own(source) == (source_item["direction"] == "out"):
        raise OpError("direction", f"{source} does not give an item that can flow out")
    if is_own(target) == (target_item["direction"] == "in"):
        raise OpError("direction", f"{target} does not take an item that can flow in")
    if is_own(source) and is_own(target):
        raise OpError("bad_request", "one end must be a step's item (step.item)")


def is_own(end: str) -> bool:
    """An end without a step: one of the action def's own items."""
    return "." not in end


def add_item_link(definition: dict, source: str, target: str) -> None:
    if is_own(source) or is_own(target):
        step_end, own = (target, source) if is_own(source) else (source, target)
        add_unique(definition, "bindings", {"ends": [step_end, own]})
        return
    add_unique(definition, "flows", {"from": source, "to": target, "succession": True})


def add_unique(owner: dict, key: str, entry: dict) -> None:
    if entry in owner.get(key, []):
        raise OpError("exists", "they are already connected")
    owner.setdefault(key, []).append(entry)


def disconnect_items(model: Model, action: str, source: str, target: str) -> Result:
    """Remove the flow or binding that connect_items made."""
    file, _, definition = action_def(model, action)
    ends = {source, target}
    removed = remove_matching(
        definition, "flows", lambda flow: {flow["from"], flow["to"]} == ends
    )
    removed += remove_matching(
        definition, "bindings", lambda binding: set(binding["ends"]) == ends
    )
    if not removed:
        raise OpError("not_found", f"{source} and {target} are not connected")
    return Result([])


# ---------------------------------------------------------------- item via port


def set_item_port(model: Model, def_name: str, perform: str, via: dict) -> Result:
    """Say which port an item of a performed action uses: `via` is {"item",
    "port"?, "portItem"?}. The port carries it as its item `portItem`, or
    one of the same name and direction, added if it has none. No port: the
    item no longer says which port it uses."""
    found = performance(model, def_name, perform)
    item = find_parameter(found.action, via["item"])
    port = None
    if via.get("port"):
        port = _port(model, def_name, via["port"])[3]
    if port and via.get("portItem"):
        chosen_port_item(port, item, via["portItem"])  # refused before any change
    ref = f"{perform}.{item['name']}"
    removed = remove_matching(
        found.owner, "flows", lambda flow: is_port_flow(found.owner, flow, ref)
    )
    if port is None:
        notes = [f"{ref} no longer says which port it uses."] if removed else []
        return Result([], notes)
    port_item, notes = port_item_for(port, item, via.get("portItem"))
    if item.get("type"):
        model.ensure_def_import(found.package, model.item_defs, item["type"])
    found.owner.setdefault("flows", []).append(item_flow(item, ref, port, port_item))
    return Result([], notes)


def item_flow(item: dict, ref: str, port: dict, port_item: str) -> dict:
    """`flow from port.item to perform.item` for an item the action gets;
    the other way for one it gives."""
    port_end = f"{ident(port)}.{port_item}"
    if item["direction"] == "out":
        return {"from": ref, "to": port_end}
    return {"from": port_end, "to": ref}


def is_port_flow(owner: dict, flow: dict, ref: str) -> bool:
    """A flow between `ref` (perform.item) and a port of `owner`."""
    ports = {ident(port) for port in owner.get("ports", [])}
    ends = [flow["from"], flow["to"]]
    return ref in ends and any(end.split(".")[0] in ports for end in ends)


def port_item_for(port: dict, item: dict, wanted: str | None) -> tuple[str, list]:
    """The port's item that carries `item`: `wanted`, or one with the item's
    name and direction, else a new one. Returns (its name, notes)."""
    if wanted:
        return chosen_port_item(port, item, wanted), []
    same = [i for i in port.get("items", []) if i["name"] == item["name"]]
    if same and same[0]["direction"] == item["direction"]:
        return item["name"], []
    return new_port_item(port, item)


def chosen_port_item(port: dict, item: dict, wanted: str) -> str:
    declared = next((i for i in port.get("items", []) if i["name"] == wanted), None)
    if declared is None:
        raise OpError("not_found", f"port {ident(port)} has no item {wanted}")
    if declared["direction"] != item["direction"]:
        raise OpError(
            "direction",
            f"{ident(port)}.{wanted} is {declared['direction']}; "
            f"{item['name']} is {item['direction']}",
        )
    return wanted


def new_port_item(port: dict, item: dict) -> tuple[str, list]:
    """The port carries the item from now on, under a name of its own."""
    items = port.setdefault("items", [])
    name = unique_item_name(items, item["name"])
    type_ = type_of(item)
    items.append(with_type({"name": name, "direction": item["direction"]}, type_))
    typed = f" : {type_}" if type_ else " (no item def yet)"
    note = f"Port {ident(port)} now carries {item['direction']} item {name}{typed}."
    return name, [note]


def unique_item_name(items: list, base: str) -> str:
    taken = {i["name"] for i in items}
    name, number = base, 2
    while name in taken:
        name, number = f"{base}_{number}", number + 1
    return name


# ---------------------------------------------------------------- the table


def tracked(call):
    """An operation whose Result lists exactly the files whose contents it
    changed (found by comparing them before and after), so its functions
    need not keep count. Call the operations through ops.run."""

    def run(model: Model, args: dict) -> Result:
        before = {file: as_text(doc) for file, doc in model.docs.items()}
        result = call(model, args)
        result.changed = sorted(
            file for file, doc in model.docs.items() if as_text(doc) != before[file]
        )
        return result

    return run


def as_text(doc: dict) -> str:
    return json.dumps(doc, sort_keys=True)


# name -> (call, required arguments, optional arguments), as ops.OPERATIONS.
ACTION_OPERATIONS = {
    "add_perform": (
        lambda m, a: add_perform(m, a["def"], a["action"], a.get("name")),
        ["def", "action"],
        ["name"],
    ),
    "delete_perform": (
        lambda m, a: delete_perform(m, a["def"], a["perform"]),
        ["def", "perform"],
        [],
    ),
    "add_step": (
        lambda m, a: add_step(
            m,
            a["sheet"],
            a["perform"],
            {"name": a["name"], "part": a["part"], "action": a.get("action")},
        ),
        ["sheet", "perform", "name", "part"],
        ["action"],
    ),
    "delete_step": (
        lambda m, a: delete_step(m, a["sheet"], a["perform"], a["step"]),
        ["sheet", "perform", "step"],
        [],
    ),
    "move_step": (
        lambda m, a: move_step(m, a["sheet"], a["perform"], a["step"], a["index"]),
        ["sheet", "perform", "step", "index"],
        [],
    ),
    "set_step_part": (
        lambda m, a: set_step_part(m, a["sheet"], a["perform"], a["step"], a["part"]),
        ["sheet", "perform", "step", "part"],
        [],
    ),
    "set_step_action": (
        lambda m, a: set_step_action(
            m, a["sheet"], a["perform"], a["step"], a["action"]
        ),
        ["sheet", "perform", "step", "action"],
        [],
    ),
    "add_action_item": (
        lambda m, a: add_action_item(
            m,
            a["action"],
            {"name": a["name"], "direction": a["direction"], "type": a["type"]},
        ),
        ["action", "name", "direction", "type"],
        [],
    ),
    "delete_action_item": (
        lambda m, a: delete_action_item(m, a["action"], a["item"]),
        ["action", "item"],
        [],
    ),
    "connect_items": (
        lambda m, a: connect_items(m, a["action"], a["from"], a["to"]),
        ["action", "from", "to"],
        [],
    ),
    "disconnect_items": (
        lambda m, a: disconnect_items(m, a["action"], a["from"], a["to"]),
        ["action", "from", "to"],
        [],
    ),
    "set_item_port": (
        lambda m, a: set_item_port(
            m,
            a["def"],
            a["perform"],
            {"item": a["item"], "port": a.get("port"), "portItem": a.get("portItem")},
        ),
        ["def", "perform", "item"],
        ["port", "portItem"],
    ),
}

ACTION_OPERATIONS = {
    name: (tracked(call), required, optional)
    for name, (call, required, optional) in ACTION_OPERATIONS.items()
}
