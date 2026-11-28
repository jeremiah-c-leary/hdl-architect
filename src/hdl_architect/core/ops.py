"""Model operations: named, validated edits of the model (SysML-shaped JSON).

The model's rules live here, once, for every front end: HA 2 (through its
server), the `ha` command line, and later an MCP server. An operation works on
the model files' contents (their file form, as on disk) and returns the ids of
the files it changed; it neither reads nor writes disk. A refusal is an
OpError with a code (for programs) and a message (for people).

Drawing rules (columns, which side a port is on) are not model rules: they stay
in HA 2.
"""

from __future__ import annotations

import re

# A name that is also a legal VHDL identifier (the schema's Name)
NAME_RE = re.compile(r"^[A-Za-z](_?[A-Za-z0-9])*$")

# Ports of these types are global nets (clocks, resets, SYSREF), joined by net,
# not by a drawn wire.
GLOBAL_DEFS = {"ClockIn", "ClockOut", "ResetIn", "ResetOut", "SysrefIn", "SysrefOut"}


class Result:
    """What an operation did: the ids of the files it changed (sorted), and
    notes for the person (e.g. what else it did on their behalf)."""

    def __init__(self, changed, notes=(), data=None):
        self.changed = sorted(changed)
        self.notes = list(notes)
        self.data = data or {}  # values for the caller, e.g. the name given


class OpError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def short(name: str | None) -> str | None:
    return name.split("::")[-1] if name else name


def ident(usage: dict) -> str:
    """A usage's identifier: its short name if it has one (SysML), else its name."""
    return usage.get("shortName") or usage["name"]


class Model:
    """The model files, {file id: document (file form)}, indexed by definition."""

    def __init__(self, docs: dict[str, dict]):
        self.docs = docs
        self.reindex()

    def reindex(self) -> None:
        """Rebuild the index (after an operation renamed or added definitions)."""
        # name -> (file, package, def)
        self.part_defs: dict[str, tuple[str, dict, dict]] = {}
        self.port_defs: dict[str, tuple[str, dict, dict]] = {}
        self.attribute_defs: dict[str, tuple[str, dict, dict]] = {}
        self.action_defs: dict[str, tuple[str, dict, dict]] = {}
        self.item_defs: dict[str, tuple[str, dict, dict]] = {}
        # id(package dict) -> qualified name
        self.package_name: dict[int, str] = {}
        for fid, doc in self.docs.items():
            if isinstance(doc.get("package"), dict):
                self._index(fid, doc["package"], "")

    def _index(self, fid: str, pkg: dict, prefix: str) -> None:
        qname = prefix + pkg["name"]
        self.package_name[id(pkg)] = qname
        for d in pkg.get("partDefs", []):
            self.part_defs[d["name"]] = (fid, pkg, d)
        for d in pkg.get("portDefs", []):
            self.port_defs[d["name"]] = (fid, pkg, d)
        for d in pkg.get("attributeDefs", []):
            self.attribute_defs[d["name"]] = (fid, pkg, d)
        for d in pkg.get("actionDefs", []):
            self.action_defs[d["name"]] = (fid, pkg, d)
        for d in pkg.get("itemDefs", []):
            self.item_defs[d["name"]] = (fid, pkg, d)
        for sub in pkg.get("packages", []):
            self._index(fid, sub, qname + "::")

    def part_def(self, name: str) -> tuple[str, dict, dict]:
        entry = self.part_defs.get(short(name))
        if entry is None:
            raise OpError("not_found", f"no part def {name}")
        return entry

    def counterpart(self, t: str) -> str:
        """The other role of a port def: its conjugateOf, or the def that names
        it as conjugateOf; else itself (a port def without named roles)."""
        t = short(t)
        entry = self.port_defs.get(t)
        if entry and entry[2].get("conjugateOf"):
            return short(entry[2]["conjugateOf"])
        for name, (_, _, d) in self.port_defs.items():
            if short(d.get("conjugateOf")) == t:
                return name
        return t

    def ensure_part_import(self, pkg: dict, def_name: str) -> None:
        """Make part def `def_name` visible in package `pkg` (add `Pkg::*`)."""
        entry = self.part_defs.get(short(def_name))
        if entry is None or entry[1] is pkg:
            return
        owner = self.package_name[id(entry[1])]
        names = {i["name"] for i in pkg.get("imports", [])}
        if f"{owner}::*" not in names and f"{owner}::{short(def_name)}" not in names:
            pkg.setdefault("imports", []).append({"name": f"{owner}::*"})

    def ensure_attribute_import(self, pkg: dict, def_name: str) -> None:
        """Make attribute def `def_name` visible in package `pkg` (add `Pkg::*`)."""
        entry = self.attribute_defs.get(short(def_name))
        if entry is None or entry[1] is pkg:
            return
        owner = self.package_name[id(entry[1])]
        names = {i["name"] for i in pkg.get("imports", [])}
        if f"{owner}::*" not in names and f"{owner}::{short(def_name)}" not in names:
            pkg.setdefault("imports", []).append({"name": f"{owner}::*"})

    def ensure_def_import(self, pkg: dict, index: dict, def_name: str) -> None:
        """Make a definition in `index` (e.g. self.action_defs) visible in
        package `pkg` (add `Pkg::*`)."""
        entry = index.get(short(def_name))
        if entry is None or entry[1] is pkg:
            return
        owner = self.package_name[id(entry[1])]
        names = {i["name"] for i in pkg.get("imports", [])}
        if f"{owner}::*" not in names and f"{owner}::{short(def_name)}" not in names:
            pkg.setdefault("imports", []).append({"name": f"{owner}::*"})

    def ensure_import(self, pkg: dict, type_name: str) -> None:
        """Make port def `type_name` visible in package `pkg` (add `Pkg::*`)."""
        entry = self.port_defs.get(short(type_name))
        if entry is None or entry[1] is pkg:
            return
        owner = self.package_name[id(entry[1])]
        names = {i["name"] for i in pkg.get("imports", [])}
        if f"{owner}::*" in names or f"{owner}::{short(type_name)}" in names:
            return
        pkg.setdefault("imports", []).append({"name": f"{owner}::*"})


class End:
    """One end of a wire on a sheet: a sheet (edge) port `p`, or `part.p`."""

    def __init__(self, model: Model, sheet: dict, ref: str):
        self.ref = ref
        head, _, tail = ref.partition(".")
        if tail:
            part = next((p for p in sheet.get("parts", []) if p["name"] == head), None)
            if part is None:
                raise OpError("not_found", f"{sheet['name']} has no part {head}")
            self.part = head
            self.file, self.pkg, self.owner = model.part_def(part.get("type", ""))
            port_name = tail
        else:
            self.part = None
            self.file, self.pkg, self.owner = model.part_def(sheet["name"])
            port_name = head
        self.usage = next(
            (u for u in self.owner.get("ports", []) if ident(u) == port_name), None
        )
        if self.usage is None:
            raise OpError("not_found", f"{self.owner['name']} has no port {port_name}")

    @property
    def is_edge(self) -> bool:
        return self.part is None

    def shown_type(self) -> str:
        return short(self.usage["type"]) + ("~" if self.usage.get("conjugated") else "")


def matching(model: Model, usage: dict, is_bind: bool) -> tuple[str, bool]:
    """The interface (type, conjugated) the other end of a wire from `usage`
    needs: the same across a bind; across a connect the other role (named
    roles via conjugateOf), or the same def conjugated when it has no named
    roles (Bus goes with ~Bus)."""
    t, conj = usage["type"], bool(usage.get("conjugated"))
    if is_bind:
        return t, conj
    other = model.counterpart(t)
    return other, (not conj) if short(other) == short(t) else conj


def give_type(model: Model, end: "End", type_: str, conjugated: bool) -> None:
    end.usage["type"] = type_
    if conjugated:
        end.usage["conjugated"] = True
    else:
        end.usage.pop("conjugated", None)
    model.ensure_import(end.pkg, type_)


def interfaces_fit(model: Model, ua: dict, ub: dict, is_bind: bool) -> bool:
    """A bind joins the same interface; a connect joins the two roles of one
    (named roles via conjugateOf, or the same def with one end conjugated)."""
    ta, tb = short(ua["type"]), short(ub["type"])
    ca, cb = bool(ua.get("conjugated")), bool(ub.get("conjugated"))
    if is_bind:
        return ta == tb and ca == cb
    return (model.counterpart(ta) == tb and not ca and not cb) or (
        ta == tb and ca != cb
    )


def connect(model: Model, sheet_name: str, a: str, b: str) -> Result:
    """Wire two existing ports on sheet `sheet_name`: two component ports
    (`part.port`) get a connect, a sheet port and a component port a bind.

    The ends' interfaces must fit; an end without an interface takes the
    matching one. A connect keeps the ends in the order given (HA 2 passes the
    left component first)."""
    sheet_file, _, sheet = model.part_def(sheet_name)
    ea, eb = End(model, sheet, a), End(model, sheet, b)
    if ea.is_edge and eb.is_edge:
        raise OpError(
            "two_sheet_ports",
            "Two sheet ports cannot be wired to each other: wire each to a component.",
        )
    if not ea.is_edge and ea.part == eb.part:
        raise OpError(
            "same_component",
            f"Both ports are on {ea.part}: wire ports of two different components.",
        )
    if any(short(e.usage.get("type")) in GLOBAL_DEFS for e in (ea, eb)):
        raise OpError(
            "net", "Clocks, resets and SYSREF are joined as nets, not by a wire."
        )
    is_bind = ea.is_edge or eb.is_edge
    pair = {a, b}
    for w in sheet.get("connections", []) + sheet.get("bindings", []):
        if set(w["ends"]) == pair:
            raise OpError("exists", f"{a} and {b} are already wired.")
    ua, ub = ea.usage, eb.usage
    if ua.get("type") and ub.get("type") and not interfaces_fit(model, ua, ub, is_bind):
        why = (
            "a sheet port and the component port it delegates to need the same "
            "interface."
            if is_bind
            else "a connection joins the two roles of one interface "
            f"({ea.shown_type()} goes with {model.counterpart(ua['type'])})."
        )
        raise OpError(
            "interfaces",
            f"{a} ({ea.shown_type()}) and {b} ({eb.shown_type()}) do not fit: {why}",
        )
    changed = {sheet_file}
    for typed, untyped in ((ea, eb), (eb, ea)):
        if typed.usage.get("type") and not untyped.usage.get("type"):
            give_type(model, untyped, *matching(model, typed.usage, is_bind))
            changed.add(untyped.file)
    if is_bind:
        edge, part = (ea, eb) if ea.is_edge else (eb, ea)
        sheet.setdefault("bindings", []).append({"ends": [edge.ref, part.ref]})
    else:
        sheet.setdefault("connections", []).append({"ends": [a, b]})
    return Result(changed)


def set_interface(
    model: Model,
    ports: list[tuple[str, str]],
    type_: str | None,
    sheet_name: str | None = None,
) -> Result:
    """Set the interface of ports, given as (part def, port identifier); None
    clears it. With `sheet_name`, an untyped port at the other end of a wire on
    that sheet gets the matching interface too (see `matching`)."""
    if type_ is not None and short(type_) not in model.port_defs:
        raise OpError("not_found", f"no port def {type_}")
    sheet = model.part_def(sheet_name)[2] if sheet_name else None
    changed, notes = set(), []
    for def_name, port in ports:
        file, pkg, owner = model.part_def(def_name)
        usage = next((u for u in owner.get("ports", []) if ident(u) == port), None)
        if usage is None:
            raise OpError("not_found", f"{def_name} has no port {port}")
        changed.add(file)
        if type_ is None:
            usage.pop("type", None)
            usage.pop("conjugated", None)
            continue
        usage["type"] = type_
        usage.pop("conjugated", None)
        model.ensure_import(pkg, type_)
        if sheet is None:
            continue
        for kind, wires in (
            ("connect", sheet.get("connections", [])),
            ("bind", sheet.get("bindings", [])),
        ):
            for w in wires:
                try:
                    ends = [End(model, sheet, r) for r in w["ends"]]
                except OpError:
                    continue  # a wire HA 2 does not draw here (e.g. a deeper chain)
                for me, other in ((ends[0], ends[1]), (ends[1], ends[0])):
                    if (
                        me.owner is not owner
                        or ident(me.usage) != port
                        or other.usage.get("type")
                    ):
                        continue
                    t, conj = matching(model, usage, kind == "bind")
                    give_type(model, other, t, conj)
                    changed.add(other.file)
                    notes.append(f"{other.ref} : {'~' if conj else ''}{short(t)}")
    if notes:
        notes = [f"Also typed the other end: {', '.join(notes)}."]
    return Result(changed, notes)


# ---------------------------------------------------------------- ports
def _port(model: Model, def_name: str, port: str) -> tuple[str, dict, dict, dict]:
    file, pkg, owner = model.part_def(def_name)
    usage = next((u for u in owner.get("ports", []) if ident(u) == port), None)
    if usage is None:
        raise OpError("not_found", f"{def_name} has no port {port}")
    return file, pkg, owner, usage


def _check_name(owner: dict, name: str) -> None:
    if not isinstance(name, str) or not NAME_RE.match(name):
        raise OpError(
            "bad_name",
            f'"{name}" is not a legal name: a letter, then letters, digits and single '
            "underscores (it must also be a legal VHDL name).",
        )
    if any(ident(u) == name for u in owner.get("ports", [])):
        raise OpError("exists", f"{owner['name']} already has a port {name}.")


def _sheets_using(model: Model, def_name: str):
    """(file, sheet def, part name) for every part typed by `def_name`."""
    for fid, _, d in model.part_defs.values():
        for part in d.get("parts", []):
            if short(part.get("type")) == def_name:
                yield fid, d, part["name"]


def _wire_lists(d: dict):
    return [d[k] for k in ("connections", "bindings") if k in d]


def add_port(
    model: Model, def_name: str, name: str, type_: str | None = None
) -> Result:
    """Add a port to a part def; the name gets _2, _3... if taken. The name
    given is in Result.data["name"]."""
    file, pkg, owner = model.part_def(def_name)
    taken = {ident(u) for u in owner.get("ports", [])}
    n, i = name, 2
    while n in taken:
        n, i = f"{name}_{i}", i + 1
    _check_name({"name": def_name}, n)
    if type_ is not None and short(type_) not in model.port_defs:
        raise OpError("not_found", f"no port def {type_}")
    owner.setdefault("ports", []).append(
        {"name": n, **({"type": type_} if type_ else {})}
    )
    if type_:
        model.ensure_import(pkg, type_)
    return Result({file}, data={"name": n})


def rename_port(model: Model, def_name: str, old: str, new: str) -> Result:
    """Rename a port (its identifier: the short name if it has one) and every
    reference to it: the wires on each sheet that uses the def, the def's own
    sheet, and the clock pairings (`clock_port`) of its other ports."""
    file, _, owner, usage = _port(model, def_name, old)
    if new == old:
        return Result([])
    _check_name(owner, new)
    usage["shortName" if "shortName" in usage else "name"] = new
    changed = {file}
    for fid, d, part in _sheets_using(model, def_name):
        for wires in _wire_lists(d):
            for w in wires:
                ends = [
                    f"{part}.{new}" if e == f"{part}.{old}" else e for e in w["ends"]
                ]
                if ends != w["ends"]:
                    w["ends"] = ends
                    changed.add(fid)
    for wires in _wire_lists(owner):  # its own sheet: the sheet port
        for w in wires:
            w["ends"] = [
                (
                    new
                    if e == old
                    else new + e[len(old) :] if e.startswith(old + ".") else e
                )
                for e in w["ends"]
            ]
    for u in owner.get("ports", []):
        if (u.get("redefines") or {}).get("clock_port") == old:
            u["redefines"]["clock_port"] = new
    _rename_in_flows(owner, old, new)
    return Result(changed)


def _rename_in_flows(owner: dict, old: str, new: str) -> None:
    """A renamed port, in the flows that say which port an action's item uses."""
    for flow in owner.get("flows", []):
        for end in ("from", "to"):
            port, dot, item = flow[end].partition(".")
            if port == old:
                flow[end] = new + dot + item


def delete_port(model: Model, def_name: str, port: str) -> Result:
    """Delete a port, every wire to it (on each sheet that uses the def and on
    its own sheet), and any clock pairing that names it."""
    file, _, owner, usage = _port(model, def_name, port)
    owner["ports"].remove(usage)
    if not owner["ports"]:
        del owner["ports"]
    changed, removed, notes = {file}, 0, []
    places = [
        (fid, d, {f"{part}.{port}"}) for fid, d, part in _sheets_using(model, def_name)
    ]
    places.append((file, owner, {port}))
    for fid, d, refs in places:
        for k in ("connections", "bindings"):
            if k not in d:
                continue
            keep = [w for w in d[k] if not refs & set(w["ends"])]
            if len(keep) != len(d[k]):
                removed += len(d[k]) - len(keep)
                changed.add(fid)
                if keep:
                    d[k] = keep
                else:
                    del d[k]
    for u in owner.get("ports", []):
        r = u.get("redefines") or {}
        if r.get("clock_port") == port:
            del r["clock_port"]
            if not r:
                del u["redefines"]
            notes.append(f"{ident(u)} is no longer paired with a clock.")
    if removed:
        notes.insert(0, f"Removed {removed} wire(s) to {def_name}.{port}.")
    notes += _remove_from_flows(owner, port)
    return Result(changed, notes)


def _flow_uses_port(flow: dict, port: str) -> bool:
    return port in (flow["from"].split(".")[0], flow["to"].split(".")[0])


def _remove_from_flows(owner: dict, port: str) -> list[str]:
    """A deleted port's flows go: its actions' items no longer say their port."""
    flows = owner.get("flows", [])
    kept = [flow for flow in flows if not _flow_uses_port(flow, port)]
    if len(kept) == len(flows):
        return []
    if kept:
        owner["flows"] = kept
    else:
        del owner["flows"]
    removed = len(flows) - len(kept)
    return [
        f"Removed {removed} flow(s) through {port}: those items no longer say "
        "which port they use."
    ]


def connect_new(model: Model, sheet_name: str, a, b) -> Result:
    """Like connect, but either end may be a new port: {"new": part name, or
    None for a sheet port, "name": base name}. The new ports are added (unique
    names), then connect() wires them with all its rules: an untyped new port
    takes the interface matching the other end. A refusal leaves the model as
    it was for the caller (the server writes nothing). Result.data gives the
    new ports' names under "a" and "b"."""
    _, _, sheet = model.part_def(sheet_name)
    refs, data, changed = [], {}, set()
    for key, end in (("a", a), ("b", b)):
        if isinstance(end, str):
            refs.append(end)
            continue
        part = end.get("new")
        if part:
            p = next((x for x in sheet.get("parts", []) if x["name"] == part), None)
            if p is None:
                raise OpError("not_found", f"{sheet_name} has no part {part}")
            def_name = short(p.get("type"))
        else:
            def_name = sheet_name
        r = add_port(model, def_name, end["name"])
        changed |= set(r.changed)
        data[key] = r.data["name"]
        refs.append(f"{part}.{data[key]}" if part else data[key])
    res = connect(model, sheet_name, refs[0], refs[1])
    return Result(changed | set(res.changed), res.notes, data)


# ---------------------------------------------------------------- parts and definitions
# The kinds of part def (PartKinds): a def says its kind by specializing one.
KINDS = {
    "SystemPart",
    "FpgaPart",
    "Fpga",
    "HwPart",
    "Subsystem",
    "Container",
    "Rtl",
    "VendorIp",
    "HardMacro",
    "RegisterFile",
    "FpgaComponent",
}
_DEF_COLLS = (
    "attributeDefs",
    "itemDefs",
    "metadataDefs",
    "portDefs",
    "partDefs",
    "actionDefs",
)
_USAGE_LISTS = (
    "parts",
    "ports",
    "attributes",
    "items",
    "parameters",
    "performs",
    "actions",
)


def pascal(name: str) -> str:
    """`temp_if` -> `TempIf` (as HA 2 names a new component's definition)."""
    return "".join(w[0].upper() + w[1:] for w in re.split(r"[_\W]+", name) if w)


def _all_defs(model: Model):
    """(file, package, collection, def) for every definition of every kind."""

    def walk(fid, pkg):
        for coll in _DEF_COLLS:
            for d in pkg.get(coll, []):
                yield fid, pkg, coll, d
        for sub in pkg.get("packages", []):
            yield from walk(fid, sub)

    for fid, doc in model.docs.items():
        if isinstance(doc.get("package"), dict):
            yield from walk(fid, doc["package"])


def _def_names(model: Model) -> set[str]:
    return {d["name"] for _, _, _, d in _all_defs(model)}


def _part(sheet: dict, name: str) -> dict:
    part = next((p for p in sheet.get("parts", []) if p["name"] == name), None)
    if part is None:
        raise OpError("not_found", f"{sheet['name']} has no part {name}")
    return part


def _check_part_name(sheet: dict, name: str) -> None:
    if not isinstance(name, str) or not NAME_RE.match(name):
        raise OpError("bad_name", f'"{name}" is not a legal name.')
    if any(p["name"] == name for p in sheet.get("parts", [])):
        raise OpError("exists", f"{sheet['name']} already has a part called {name}.")


def _rename_ref(text: str, old: str, new: str) -> str:
    """A reference `old` or `old.x...` on a sheet, renamed."""
    return (
        new
        if text == old
        else new + text[len(old) :] if text.startswith(old + ".") else text
    )


def add_part(
    model: Model,
    sheet_name: str,
    name: str,
    kind: str | None = None,
    def_name: str | None = None,
) -> Result:
    """Add a part to a sheet: of an existing part def (`def_name`), or of a new
    part def of `kind` (named after the part in PascalCase, made unique), in
    the sheet's package. Result.data["type"] is the part's def."""
    file, pkg, sheet = model.part_def(sheet_name)
    _check_part_name(sheet, name)
    if (kind is None) == (def_name is None):
        raise OpError("bad_request", "give either a kind or a part def")
    if def_name is not None:
        model.part_def(def_name)
        type_ = short(def_name)
    else:
        if short(kind) not in KINDS or short(kind) not in model.part_defs:
            raise OpError("not_found", f"no kind {kind}")
        taken, base = _def_names(model), pascal(name) or "Part"
        type_, i = base, 2
        while type_ in taken:
            type_, i = f"{base}{i}", i + 1
        pkg.setdefault("partDefs", []).append(
            {"name": type_, "specializes": [short(kind)]}
        )
        model.part_defs[type_] = (file, pkg, pkg["partDefs"][-1])
        model.ensure_part_import(pkg, kind)
    model.ensure_part_import(pkg, type_)
    sheet.setdefault("parts", []).append({"name": name, "type": type_})
    return Result({file}, data={"type": type_})


def rename_part(model: Model, sheet_name: str, old: str, new: str) -> Result:
    """Rename a part and every reference to it on its sheet: wires (`old.port`)
    and allocations."""
    file, _, sheet = model.part_def(sheet_name)
    part = _part(sheet, old)
    if new == old:
        return Result([])
    _check_part_name(sheet, new)
    part["name"] = new
    for wires in _wire_lists(sheet):
        for w in wires:
            w["ends"] = [_rename_ref(e, old, new) for e in w["ends"]]
    for a in sheet.get("allocations", []):
        a["from"], a["to"] = _rename_ref(a["from"], old, new), _rename_ref(
            a["to"], old, new
        )
    return Result({file})


def delete_part(model: Model, sheet_name: str, name: str) -> Result:
    """Delete a part and every wire and allocation on its sheet that refers to it."""
    file, _, sheet = model.part_def(sheet_name)
    sheet["parts"].remove(_part(sheet, name))
    hit = lambda e: e == name or e.startswith(name + ".")  # noqa: E731
    removed = 0
    for k in ("connections", "bindings"):
        if k in sheet:
            keep = [w for w in sheet[k] if not any(hit(e) for e in w["ends"])]
            removed += len(sheet[k]) - len(keep)
            sheet[k] = keep
    if "allocations" in sheet:
        sheet["allocations"] = [
            a for a in sheet["allocations"] if not (hit(a["from"]) or hit(a["to"]))
        ]
    for k in ("connections", "bindings", "allocations", "parts"):
        if k in sheet and not sheet[k]:
            del sheet[k]
    notes = [f"Removed {removed} wire(s) to {name}."] if removed else []
    return Result({file}, notes)


def rename_def(model: Model, old: str, new: str) -> Result:
    """Rename a definition (of any kind) and every reference to it in the model:
    specializations, the types of every usage (parts, ports, attributes, items,
    parameters, performs, actions, metadata), conjugateOf, and imports that
    name it."""
    entry = next(
        ((f, p, c, d) for f, p, c, d in _all_defs(model) if d["name"] == old), None
    )
    if entry is None:
        raise OpError("not_found", f"no definition {old}")
    if new == old:
        return Result([])
    if not isinstance(new, str) or not NAME_RE.match(new):
        raise OpError("bad_name", f'"{new}" is not a legal name.')
    if new in _def_names(model):
        raise OpError("exists", f"{new} already exists.")

    def ref(name):  # `Old` or `Pkg::Old` -> renamed; anything else unchanged
        if isinstance(name, str) and short(name) == old:
            return name[: len(name) - len(old)] + new
        return name

    changed = set()
    for fid, pkg, coll, d in _all_defs(model):
        before = repr(d)
        if d is entry[3]:
            d["name"] = new
        if "specializes" in d:
            d["specializes"] = [ref(x) for x in d["specializes"]]
        if "conjugateOf" in d:
            d["conjugateOf"] = ref(d["conjugateOf"])
        for lst in _USAGE_LISTS:
            for u in d.get(lst, []):
                if "type" in u:
                    u["type"] = ref(u["type"])
        for m in d.get("metadata", []):
            m["type"] = ref(m["type"])
        if repr(d) != before:
            changed.add(fid)
    for fid, doc in model.docs.items():

        def walk(pkg):
            hit = False
            for i in pkg.get("imports", []):
                if i["name"].endswith("::" + old):
                    i["name"] = i["name"][: -len(old)] + new
                    hit = True
            for sub in pkg.get("packages", []):
                hit = walk(sub) or hit
            return hit

        if isinstance(doc.get("package"), dict) and walk(doc["package"]):
            changed.add(fid)
    model.reindex()
    return Result(changed)


def set_part_def(
    model: Model, sheet_name: str, part_name: str, def_name: str
) -> Result:
    """Change which part def a part is. Wires to ports the new def does not
    have are removed (they would point at nothing), with a note."""
    file, pkg, sheet = model.part_def(sheet_name)
    part = _part(sheet, part_name)
    _, _, new_def = model.part_def(def_name)
    part["type"] = short(def_name)
    model.ensure_part_import(pkg, def_name)
    have = {ident(u) for u in new_def.get("ports", [])}
    dead = (
        lambda e: e.startswith(part_name + ".") and e.split(".")[1] not in have
    )  # noqa: E731
    removed = 0
    for k in ("connections", "bindings"):
        if k in sheet:
            keep = [w for w in sheet[k] if not any(dead(e) for e in w["ends"])]
            removed += len(sheet[k]) - len(keep)
            sheet[k] = keep
            if not keep:
                del sheet[k]
    notes = (
        [f"Removed {removed} wire(s) to ports {short(def_name)} does not have."]
        if removed
        else []
    )
    return Result({file}, notes)


def set_kind(model: Model, def_name: str, kind: str) -> Result:
    """Make a part def of another kind: its kind specialization is replaced."""
    file, pkg, d = model.part_def(def_name)
    if short(kind) not in KINDS or short(kind) not in model.part_defs:
        raise OpError("not_found", f"no kind {kind}")
    rest = [x for x in d.get("specializes", []) if short(x) not in KINDS]
    d["specializes"] = [short(kind), *rest]
    model.ensure_part_import(pkg, kind)
    return Result({file})


# ---------------------------------------------------------------- global nets
# Clocks, resets and SYSREF are global nets: each port def has a category and
# a direction. A net's source is a sheet input or a component output; its
# sinks are component inputs (and sheet outputs). A net is a bind or connect
# from the source to each sink.
GLOBAL = {
    "ClockIn": ("clock", "in"),
    "ClockOut": ("clock", "out"),
    "ResetIn": ("reset", "in"),
    "ResetOut": ("reset", "out"),
    "SysrefIn": ("sysref", "in"),
    "SysrefOut": ("sysref", "out"),
}


def global_info(end: End) -> tuple[str, bool] | None:
    """(category, is a source) of a global port on a sheet, else None."""
    g = GLOBAL.get(short(end.usage.get("type")))
    if not g:
        return None
    direction = g[1]
    if end.usage.get("conjugated"):
        direction = "out" if direction == "in" else "in"
    return g[0], (direction == "in" if end.is_edge else direction == "out")


def _base_def(model: Model, type_: str) -> dict | None:
    entry = model.port_defs.get(short(type_))
    d = entry[2] if entry else None
    if d and d.get("conjugateOf"):
        base = model.port_defs.get(short(d["conjugateOf"]))
        d = base[2] if base else d
    return d


def has_param(model: Model, type_: str, name: str) -> bool:
    """Does the port def (or the one it mirrors) declare parameter `name`?"""
    d = _base_def(model, type_)
    return bool(d) and any(
        a["name"] == name and "direction" not in a for a in d.get("attributes", [])
    )


def global_def_for(model: Model, cat: str, direction: str) -> tuple[str, bool] | None:
    """The port def (and conjugation) for a new global port: e.g. ClockOut, or
    ~ClockIn when the model has only ClockIn."""
    for conj, want in (
        (False, direction),
        (True, "out" if direction == "in" else "in"),
    ):
        name = next(n for n, g in GLOBAL.items() if g == (cat, want))
        if name in model.port_defs:
            return name, conj
    return None


def _clocks(owner: dict) -> list[dict]:
    return [
        u
        for u in owner.get("ports", [])
        if GLOBAL.get(short(u.get("type")), ("",))[0] == "clock"
    ]


def _pair(model: Model, usage: dict, clock: str | None) -> None:
    r = usage.setdefault("redefines", {})
    if clock:
        r["clock_port"] = clock
    else:
        r.pop("clock_port", None)
    cat = GLOBAL.get(short(usage.get("type")), ("",))[0]
    if cat == "reset" and has_param(model, usage["type"], "synchronous"):
        r["synchronous"] = bool(clock)  # paired with a clock: synchronous
    if not r:
        del usage["redefines"]


def pair_clock(model: Model, def_name: str, port: str, clock: str | None) -> Result:
    """Pair a reset or SYSREF port with a clock port of the same def (None:
    unpair). A paired reset is synchronous, an unpaired one asynchronous."""
    file, _, owner, usage = _port(model, def_name, port)
    cat = GLOBAL.get(short(usage.get("type")), ("",))[0]
    if cat not in ("reset", "sysref") or not has_param(
        model, usage["type"], "clock_port"
    ):
        raise OpError(
            "not_pairable",
            f"{def_name}.{port} is not a reset or SYSREF with a clock_port.",
        )
    if clock is not None and not any(ident(u) == clock for u in _clocks(owner)):
        raise OpError("not_a_clock", f"{def_name} has no clock port {clock}.")
    _pair(model, usage, clock)
    return Result({file})


def assign_net(
    model: Model,
    sheet_name: str,
    end_ref: str,
    source_ref: str | None,
    retype: bool = False,
) -> Result:
    """Put a sink (`end_ref`) on the net of `source_ref`, or on none. Its old net
    wire is removed. With `retype`, the sink first becomes an input of the net's
    category (e.g. a plain port onto a clock net); a SYSREF made so is paired
    with its def's only clock."""
    file, _, sheet = model.part_def(sheet_name)
    end = End(model, sheet, end_ref)
    changed = {file}
    src = None
    if source_ref is not None:
        src = End(model, sheet, source_ref)
        si = global_info(src)
        if not si or not si[1]:
            raise OpError("not_a_source", f"{source_ref} does not drive a net.")
        if retype:
            t = global_def_for(model, si[0], "in")
            if t is None:
                raise OpError("not_found", f"The model has no {si[0]} input port def.")
            give_type(model, end, *t)
            changed.add(end.file)
            clocks = _clocks(end.owner)
            if (
                si[0] == "sysref"
                and has_param(model, t[0], "clock_port")
                and len(clocks) == 1
            ):
                _pair(model, end.usage, ident(clocks[0]))
    ei = global_info(end)
    if not ei:
        raise OpError("not_global", f"{end_ref} is not a clock, reset or SYSREF port.")
    if ei[1]:
        raise OpError("is_a_source", f"{end_ref} drives a net itself.")
    if src is not None and ei[0] != global_info(src)[0]:
        raise OpError(
            "wrong_kind",
            f"{end_ref} is a {ei[0]} port and {source_ref} drives a "
            f"{global_info(src)[0]} net.",
        )

    def is_net_wire(w):
        if end_ref not in w["ends"]:
            return False
        try:
            a, b = (End(model, sheet, r) for r in w["ends"])
        except OpError:
            return False
        ga, gb = global_info(a), global_info(b)
        return bool(ga and gb and ga[0] == gb[0])

    for k in ("connections", "bindings"):
        if k in sheet:
            sheet[k] = [w for w in sheet[k] if not is_net_wire(w)]
            if not sheet[k]:
                del sheet[k]
    if src is not None:
        if src.is_edge or end.is_edge:
            edge, other = (src, end) if src.is_edge else (end, src)
            sheet.setdefault("bindings", []).append({"ends": [edge.ref, other.ref]})
        else:
            sheet.setdefault("connections", []).append({"ends": [src.ref, end.ref]})
    return Result(changed)


def set_frequency(model: Model, sheet_name: str, source_ref: str, hz: float) -> Result:
    """Set the frequency of the net driven by `source_ref` (on the source port)."""
    _, _, sheet = model.part_def(sheet_name)
    src = End(model, sheet, source_ref)
    si = global_info(src)
    if not si or not si[1]:
        raise OpError("not_a_source", f"{source_ref} does not drive a net.")
    if not isinstance(hz, (int, float)) or isinstance(hz, bool) or hz <= 0:
        raise OpError("bad_value", "A frequency must be a positive number of Hz.")
    src.usage.setdefault("redefines", {})["frequency_hz"] = float(hz)
    return Result({src.file})


def add_global_port(
    model: Model, def_name: str, cat: str, direction: str, name: str
) -> Result:
    """Add a clock, reset or SYSREF port (`direction` "in" or "out"). A SYSREF
    input is paired with the def's only clock; otherwise a note says what to
    pair. Result.data["name"] is the name given."""
    if (cat, direction) not in GLOBAL.values():
        raise OpError("bad_request", f"no global port kind {cat} {direction}")
    t = global_def_for(model, cat, direction)
    if t is None:
        kinds = " / ".join(n for n, g in GLOBAL.items() if g[0] == cat)
        raise OpError("not_found", f"The model has no {cat} port def ({kinds}).")
    r = add_port(model, def_name, name, t[0])
    file, _, owner, usage = _port(model, def_name, r.data["name"])
    if t[1]:
        usage["conjugated"] = True
    notes, clocks = [], _clocks(owner)
    if cat == "sysref" and direction == "in" and has_param(model, t[0], "clock_port"):
        if len(clocks) == 1:
            _pair(model, usage, ident(clocks[0]))
        elif clocks:
            notes.append(
                f"{def_name}.{r.data['name']}: pair it with its device clock "
                f"({', '.join(ident(c) for c in clocks)})."
            )
    elif cat == "reset" and direction == "in" and has_param(model, t[0], "clock_port"):
        notes.append(
            f"{def_name}.{r.data['name']} is asynchronous; pair it with a clock "
            "if it is synchronous."
        )
    return Result({file}, notes, r.data)


# -------------------------------------------------- wires, descriptions, names
def delete_wire(model: Model, sheet_name: str, a: str, b: str) -> Result:
    """Delete the wire (connect or bind) between ends `a` and `b` on a sheet."""
    file, _, sheet = model.part_def(sheet_name)
    for k in ("connections", "bindings"):
        for w in sheet.get(k, []):
            if set(w["ends"]) == {a, b}:
                sheet[k].remove(w)
                if not sheet[k]:
                    del sheet[k]
                return Result({file})
    raise OpError("not_found", f"no wire between {a} and {b} on {sheet_name}")


def set_doc(model: Model, def_name: str, port: str | None, text: str | None) -> Result:
    """Set the description (SysML doc) of a definition, or of one of its ports;
    empty removes it. Lines are trimmed."""
    if port is None:
        entry = next(
            ((f, d) for f, _, _, d in _all_defs(model) if d["name"] == def_name), None
        )
        if entry is None:
            raise OpError("not_found", f"no definition {def_name}")
        file, obj = entry
    else:
        file, _, _, obj = _port(model, def_name, port)
    t = "\n".join(line.strip() for line in (text or "").split("\n")).strip()
    if t:
        obj["doc"] = t
    else:
        obj.pop("doc", None)
    return Result({file})


def set_port_name(model: Model, def_name: str, port: str, label: str | None) -> Result:
    """Give a port a readable SysML name ("Processing CSR"), or remove it (None,
    empty, or the identifier itself). The identifier stays: in the file the
    readable text is `name` and the identifier `shortName`."""
    file, _, _, usage = _port(model, def_name, port)
    t = (label or "").strip()
    if any(c in t for c in "'\\\n\r"):
        raise OpError(
            "bad_name", "A port name cannot contain quotes, backslashes or line breaks."
        )
    if t and t != port:
        usage["shortName"], usage["name"] = port, t
    elif "shortName" in usage:
        usage["name"] = usage.pop("shortName")
    return Result({file})


# -------------------------------------------------- the operations, by name
# Every front end runs an operation by name with arguments by name: HA 2's
# server (POST /api/op), `ha op NAME key=value ...`, and later an MCP server.
# name -> (call(model, args) -> Result, required args, optional args)
# ---------------------------------------------------------------- estimates
# A leaf block's resource estimate (core.resources has the model's shape):
# an attribute typed by a device family's resources, with values. Roll-up
# blocks (with parts, or of a roll-up kind) are the sum of their parts and
# may not have one.


def set_estimate(model: Model, def_name: str, family: str, values: dict) -> Result:
    """Set a leaf part def's estimate in a device family's resources; no
    values (or all zero) removes it."""
    file, pkg, definition = model.part_def(def_name)
    _refuse_roll_up(model, definition)
    names = _resource_names(model, family)
    _check_estimate_values(values, names, family)
    counts = {name: values[name] for name in names if values.get(name)}
    if not counts:
        _remove_estimate(definition, family)
        return Result({file})
    _estimate_attribute(definition, family)["redefines"] = counts
    model.ensure_attribute_import(pkg, family)
    return Result({file})


def estimate_name(family: str) -> str:
    """ZynqUltraScalePlusResources -> zynqUltraScalePlusEstimate."""
    base = family.removesuffix("Resources")
    return base[0].lower() + base[1:] + "Estimate"


def _refuse_roll_up(model: Model, definition: dict) -> None:
    from hdl_architect.core.resources import ROLL_UP_KINDS

    kind = ROLL_UP_KINDS & _part_generals(model, definition["name"])
    if definition.get("parts") or kind:
        what = f"a {sorted(kind)[0]}" if kind else "a block with parts"
        raise OpError(
            "roll_up",
            f"{definition['name']} is {what}: its resources are the sum of its "
            "parts. Break it down, and estimate the parts.",
        )


def _part_generals(model: Model, name: str) -> set[str]:
    """A part def and every part def it specializes, directly or not."""
    found: set[str] = set()
    pending = [short(name)]
    while pending:
        current = pending.pop()
        if current in found or current not in model.part_defs:
            continue
        found.add(current)
        definition = model.part_defs[current][2]
        pending += [short(n) for n in definition.get("specializes", [])]
    return found


def _resource_names(model: Model, family: str) -> list[str]:
    """The resource names of a device family's resources def."""
    from hdl_architect.core.resources import RESOURCES_ROOT

    chain = _attribute_generals(model, short(family))
    if RESOURCES_ROOT not in chain:
        raise OpError("not_found", f"no device family resources {family}")
    names = []
    for name in reversed(chain):
        attributes = model.attribute_defs[name][2].get("attributes", [])
        names += [attribute["name"] for attribute in attributes]
    return names


def _attribute_generals(model: Model, name: str) -> list[str]:
    """An attribute def and the attribute defs it specializes, nearest first."""
    chain: list[str] = []
    pending = [name]
    while pending:
        current = pending.pop(0)
        if current in chain or current not in model.attribute_defs:
            continue
        chain.append(current)
        definition = model.attribute_defs[current][2]
        pending += [short(n) for n in definition.get("specializes", [])]
    return chain


def _check_estimate_values(values: dict, names: list[str], family: str) -> None:
    if not isinstance(values, dict):
        raise OpError("bad_value", "An estimate is {resource: count}.")
    for name, count in values.items():
        if name not in names:
            raise OpError("bad_value", f"{family} has no resource {name}.")
        if not _is_count(count):
            raise OpError("bad_value", f"{name}: a count is a whole number, 0 or more.")


def _is_count(value) -> bool:
    is_integer = isinstance(value, int) and not isinstance(value, bool)
    return is_integer and value >= 0


def _estimate_attribute(definition: dict, family: str) -> dict:
    """The part def's estimate in this family (kept with its doc), or a new one."""
    attributes = definition.setdefault("attributes", [])
    for attribute in attributes:
        if short(attribute["type"]) == short(family):
            return attribute
    attribute = {"name": estimate_name(family), "type": family}
    attributes.append(attribute)
    return attribute


def _remove_estimate(definition: dict, family: str) -> None:
    attributes = definition.get("attributes", [])
    kept = [a for a in attributes if short(a["type"]) != short(family)]
    if kept:
        definition["attributes"] = kept
    else:
        definition.pop("attributes", None)


# ---------------------------------------------------------------- the target device
FPGA_KINDS = {"FpgaPart", "Fpga"}


def set_device(model: Model, def_name: str, device: str) -> Result:
    """Make `device` the FPGA's target device (`attribute device : <device>`)."""
    from hdl_architect.core.resources import DEVICE_ROOT

    file, pkg, fpga = model.part_def(def_name)
    if not FPGA_KINDS & _part_generals(model, def_name):
        raise OpError("not_an_fpga", f"{def_name} is not an FPGA: it has no device.")
    chain = _attribute_generals(model, short(device))
    is_abstract = chain and model.attribute_defs[chain[0]][2].get("isAbstract")
    if DEVICE_ROOT not in chain or is_abstract:
        raise OpError("not_found", f"no device {device}")
    current = _device_attribute(model, fpga)
    notes = _family_change_notes(model, current, short(device))
    _set_device_attribute(fpga, current, short(device))
    model.ensure_attribute_import(pkg, device)
    return Result({file}, notes)


def _device_attribute(model: Model, fpga: dict) -> dict | None:
    """The FPGA's attribute typed by a device, if it has one."""
    from hdl_architect.core.resources import DEVICE_ROOT

    for attribute in fpga.get("attributes", []):
        if DEVICE_ROOT in _attribute_generals(model, short(attribute["type"])):
            return attribute
    return None


def _set_device_attribute(fpga: dict, current: dict | None, device: str) -> None:
    if current is not None:
        current["type"] = device
        return
    attributes = fpga.setdefault("attributes", [])
    attributes.append({"name": "device", "type": device})


def _family_change_notes(model: Model, current: dict | None, device: str) -> list:
    """A note when the new device is of another family: estimates do not carry."""
    if current is None:
        return []
    before = _device_family(model, short(current["type"]))
    after = _device_family(model, device)
    if before == after:
        return []
    return [
        f"{device} is a {after} device; the estimates are in {before}. "
        f"Leaves need estimates in {after}."
    ]


def _device_family(model: Model, device: str) -> str | None:
    """The resources def a device's capacity is given in."""
    from hdl_architect.core.resources import RESOURCES_ROOT

    for name in _attribute_generals(model, device):
        for attribute in model.attribute_defs[name][2].get("attributes", []):
            if RESOURCES_ROOT in _attribute_generals(model, short(attribute["type"])):
                return short(attribute["type"])
    return None


OPERATIONS = {
    "connect": (
        lambda m, a: connect(m, a["sheet"], a["a"], a["b"]),
        ["sheet", "a", "b"],
        [],
    ),
    "connect_new": (
        lambda m, a: connect_new(m, a["sheet"], a["a"], a["b"]),
        ["sheet", "a", "b"],
        [],
    ),
    "set_interface": (
        lambda m, a: set_interface(
            m,
            [(x["def"], x["port"]) for x in a["ports"]],
            a.get("type"),
            a.get("sheet"),
        ),
        ["ports"],
        ["type", "sheet"],
    ),
    "add_port": (
        lambda m, a: add_port(m, a["def"], a["name"], a.get("type")),
        ["def", "name"],
        ["type"],
    ),
    "rename_port": (
        lambda m, a: rename_port(m, a["def"], a["old"], a["new"]),
        ["def", "old", "new"],
        [],
    ),
    "delete_port": (
        lambda m, a: delete_port(m, a["def"], a["port"]),
        ["def", "port"],
        [],
    ),
    "add_part": (
        lambda m, a: add_part(m, a["sheet"], a["name"], a.get("kind"), a.get("def")),
        ["sheet", "name"],
        ["kind", "def"],
    ),
    "rename_part": (
        lambda m, a: rename_part(m, a["sheet"], a["old"], a["new"]),
        ["sheet", "old", "new"],
        [],
    ),
    "delete_part": (
        lambda m, a: delete_part(m, a["sheet"], a["name"]),
        ["sheet", "name"],
        [],
    ),
    "rename_def": (lambda m, a: rename_def(m, a["old"], a["new"]), ["old", "new"], []),
    "set_part_def": (
        lambda m, a: set_part_def(m, a["sheet"], a["part"], a["def"]),
        ["sheet", "part", "def"],
        [],
    ),
    "set_kind": (lambda m, a: set_kind(m, a["def"], a["kind"]), ["def", "kind"], []),
    "pair_clock": (
        lambda m, a: pair_clock(m, a["def"], a["port"], a.get("clock")),
        ["def", "port"],
        ["clock"],
    ),
    "assign_net": (
        lambda m, a: assign_net(
            m, a["sheet"], a["end"], a.get("source"), bool(a.get("retype"))
        ),
        ["sheet", "end"],
        ["source", "retype"],
    ),
    "set_frequency": (
        lambda m, a: set_frequency(m, a["sheet"], a["source"], a["hz"]),
        ["sheet", "source", "hz"],
        [],
    ),
    "add_global_port": (
        lambda m, a: add_global_port(m, a["def"], a["cat"], a["dir"], a["name"]),
        ["def", "cat", "dir", "name"],
        [],
    ),
    "delete_wire": (
        lambda m, a: delete_wire(m, a["sheet"], a["a"], a["b"]),
        ["sheet", "a", "b"],
        [],
    ),
    "set_doc": (
        lambda m, a: set_doc(m, a["def"], a.get("port"), a.get("text")),
        ["def"],
        ["port", "text"],
    ),
    "set_port_name": (
        lambda m, a: set_port_name(m, a["def"], a["port"], a.get("name")),
        ["def", "port"],
        ["name"],
    ),
    "set_device": (
        lambda m, a: set_device(m, a["def"], a["device"]),
        ["def", "device"],
        [],
    ),
    "set_estimate": (
        lambda m, a: set_estimate(m, a["def"], a["family"], a.get("values") or {}),
        ["def", "family"],
        ["values"],
    ),
}


def operations() -> dict:
    """Every operation: this module's, the performed actions' (action_ops,
    action_links, action_hops and action_walk) and the address map's
    (address_ops). They build on this module, so they are imported here,
    when first needed."""
    from hdl_architect.core.action_hops import HOP_OPERATIONS
    from hdl_architect.core.address_ops import ADDRESS_OPERATIONS
    from hdl_architect.core.action_links import LINK_OPERATIONS
    from hdl_architect.core.action_ops import ACTION_OPERATIONS
    from hdl_architect.core.action_walk import WALK_OPERATIONS

    return {
        **OPERATIONS,
        **ACTION_OPERATIONS,
        **LINK_OPERATIONS,
        **HOP_OPERATIONS,
        **WALK_OPERATIONS,
        **ADDRESS_OPERATIONS,
    }


def run(model: Model, name: str, args: dict) -> Result:
    """Run operation `name` with `args`; unknown names, missing or unknown
    arguments are refused (a typo is never ignored)."""
    every = operations()
    if name not in every:
        raise OpError("unknown_op", f"no operation {name!r} (see `ha op --list`)")
    call, required, optional = every[name]
    missing = [k for k in required if k not in args]
    extra = [k for k in args if k not in required and k not in optional]
    if missing or extra:
        raise OpError(
            "bad_request",
            f"{name}: "
            + "; ".join(
                ([f"missing {', '.join(missing)}"] if missing else [])
                + ([f"unknown {', '.join(extra)}"] if extra else [])
            )
            + f" (takes {', '.join(required + [k + '?' for k in optional])})",
        )
    return call(model, args)
