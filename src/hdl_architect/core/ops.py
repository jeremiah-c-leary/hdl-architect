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
    return Result(changed)


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
    return Result(changed, notes)


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
