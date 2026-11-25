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

# Ports of these types are global nets (clocks, resets, SYSREF), joined by net,
# not by a drawn wire.
GLOBAL_DEFS = {"ClockIn", "ClockOut", "ResetIn", "ResetOut", "SysrefIn", "SysrefOut"}


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
        self.part_defs: dict[str, tuple[str, dict, dict]] = (
            {}
        )  # name -> (file, package, def)
        self.port_defs: dict[str, tuple[str, dict, dict]] = {}
        self.package_name: dict[int, str] = {}  # id(package dict) -> qualified name
        for fid, doc in docs.items():
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


def connect(model: Model, sheet_name: str, a: str, b: str) -> list[str]:
    """Wire two existing ports on sheet `sheet_name`: two component ports
    (`part.port`) get a connect, a sheet port and a component port a bind.

    The ends' interfaces must fit; an end without an interface takes the
    matching one. A connect keeps the ends in the order given (HA 2 passes the
    left component first). Returns the ids of the files changed."""
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
            t = typed.usage["type"]
            other = t if is_bind else model.counterpart(t)
            untyped.usage["type"] = other
            conj = bool(typed.usage.get("conjugated"))
            if not is_bind and short(other) == short(t):
                conj = not conj  # no named roles: the other end is ~t
            if conj:
                untyped.usage["conjugated"] = True
            model.ensure_import(untyped.pkg, other)
            changed.add(untyped.file)
    if is_bind:
        edge, part = (ea, eb) if ea.is_edge else (eb, ea)
        sheet.setdefault("bindings", []).append({"ends": [edge.ref, part.ref]})
    else:
        sheet.setdefault("connections", []).append({"ends": [a, b]})
    return sorted(changed)
