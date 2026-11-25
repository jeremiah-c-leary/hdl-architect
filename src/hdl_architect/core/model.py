"""
hdl_architect.core.model - the model reader: SysML-shaped JSON -> elaborated IR.

The model is a set of SysML-shaped JSON files (one JSON object per SysML
element), validated against core/schema/sysml-json.schema.json. This module
is the only code that reads model files. Generators call `load_ir()` and
work only with the dataclasses below (the IR: Instance, Port, Signal).

Model files are found on a search path (like a VHDL library path): every
.json file with a "schemaVersion" under each directory is loaded. File paths
in @HdlSource are relative to the file that declares them.

CLI:  ha ir --path DIR [--path DIR ...] --top FpgaOne [--out ir.json]
"""
from __future__ import annotations

import ast
import operator
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator

RESOURCE_ATTRS = {"lut", "ff", "dsp", "bram", "uram"}


@dataclass
class Signal:
    name: str                       # signal name within the port, e.g. "awaddr"
    direction: str                  # "in" / "out" / "inout", from this part's side
    width: int | None               # None = single bit (Logic)


@dataclass
class Port:
    name: str
    type: str
    conjugated: bool
    signals: list[Signal] = field(default_factory=list)
    params: dict[str, object] = field(default_factory=dict)   # e.g. frequency_hz
    doc: str = ""                   # the port's `doc` in the model
    declared: str = ""              # the interface as written: "AxiLite", "~AxiLite", "Axi4StreamReceiver"
    title: str = ""                 # the readable SysML name when the port has a shortName ("Processing CSR")

    def hdl_names(self) -> list[tuple[str, Signal]]:
        """(HDL port name, signal): 'clk' for one-signal ports, else 'csr_awaddr'."""
        if len(self.signals) == 1:
            return [(self.name, self.signals[0])]
        return [(f"{self.name}_{s.name}", s) for s in self.signals]


@dataclass
class Instance:
    name: str                       # instance name, e.g. "tx_core"
    definition: str                 # definition name, e.g. "UartTx"
    kind: str | None                # Rtl, VendorIp, HardMacro, RegisterFile, Subsystem, Fpga
    metadata: dict[str, dict]       # {"HdlSource": {...}, "Provenance": {...}, ...}
    generics: dict[str, object]     # values for this instance (overrides applied)
    generic_defaults: dict[str, object]  # defaults declared on the definition
    generic_types: dict[str, str]   # generic name -> SysML type name (Integer, Real, ...)
    ports: list[Port]
    connections: list[tuple[str, str]]
    bindings: list[tuple[str, str]]
    count: int = 1                  # multiplicity, e.g. part mon : X[4]
    children: list["Instance"] = field(default_factory=list)
    path: str = ""                  # hierarchical path, e.g. "fpga_one/serial/tx_core"
    source_file: Path | None = None # .sysml file that defines this definition

    def walk(self) -> Iterator["Instance"]:
        """Pre-order: parent before children."""
        yield self
        for c in self.children:
            yield from c.walk()

    def walk_post(self) -> Iterator["Instance"]:
        """Post-order: children before parent (compile order)."""
        for c in self.children:
            yield from c.walk_post()
        yield self


class ModelError(Exception):
    pass


def _resolve_sources(meta: dict, source_file: Path | None) -> None:
    """Make @HdlSource files absolute, relative to the declaring .sysml file."""
    src = meta.get("HdlSource")
    if not src or source_file is None:
        return
    files = src.get("files") or []
    if isinstance(files, str):
        files = [files]
    src["files_declared"] = list(files)
    src["files"] = [str((source_file.parent / f).resolve()) for f in files]


_FLIP = {"in": "out", "out": "in", "inout": "inout"}
_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
        ast.Div: operator.floordiv, ast.FloorDiv: operator.floordiv}


def _eval_width(expr: str, names: dict[str, object]) -> int:
    """Evaluate a width expression such as 'data_width / 8' against port parameters."""
    def ev(node):
        if isinstance(node, ast.Expression):
            return ev(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, int):
            return node.value
        if isinstance(node, ast.Name):
            if node.id not in names or not isinstance(names[node.id], int):
                raise ModelError(f"width refers to unknown or non-integer '{node.id}'")
            return names[node.id]
        if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
            return _OPS[type(node.op)](ev(node.left), ev(node.right))
        raise ModelError(f"unsupported width expression '{expr}'")
    return ev(ast.parse(expr.strip(), mode="eval"))


# ----------------------------------------------------------------------
# JSON front end: SysML-shaped JSON (schema/sysml-json.schema.json)
# One JSON object is one SysML element, so no parser and no workarounds:
# the model is read with json.load(), checked against the schema, names are
# resolved through each package's imports, and the same elaboration rules
# as the original .sysml front end build the Instance tree.
# ----------------------------------------------------------------------
JSON_SCHEMA = Path(__file__).resolve().parent / "schema" / "sysml-json.schema.json"
# Names from the SysML standard library that our models use without defining.
_STDLIB = {"Boolean", "Integer", "Real", "String", "Natural", "Positive", "Number", "Complex"}
_STDLIB_PKGS = {"ScalarValues", "NumericalFunctions", "ISQ", "SI"}
_DEF_KINDS = ("attributeDefs", "itemDefs", "metadataDefs", "portDefs", "partDefs", "actionDefs")


def _json_files(search_path) -> list[Path]:
    if isinstance(search_path, (str, Path)):
        search_path = [search_path]
    files: list[Path] = []
    for d in map(Path, search_path):
        if not d.is_dir():
            raise ModelError(f"search path entry {d} is not a directory")
        files += sorted(d.rglob("*.json"))
    return files


class _JsonModel:
    """The definitions of all JSON model files on the search path, by name."""

    def __init__(self, search_path):
        import json
        import jsonschema
        if not JSON_SCHEMA.is_file():
            raise ModelError(f"the JSON schema is missing: {JSON_SCHEMA}")
        validator = jsonschema.Draft202012Validator(json.loads(JSON_SCHEMA.read_text(encoding="utf-8")))
        self.defs: dict[str, tuple[str, dict, str, Path]] = {}    # name -> (kind, def, package, file)
        self.packages: dict[str, tuple[dict, Path]] = {}
        for f in _json_files(search_path):
            doc = json.loads(f.read_text(encoding="utf-8"))
            if not isinstance(doc, dict) or "schemaVersion" not in doc:
                continue                                             # not a model file
            errors = sorted(validator.iter_errors(doc), key=lambda e: list(map(str, e.absolute_path)))
            if errors:
                raise ModelError(f"{f}: not valid SysML-shaped JSON:\n  " + "\n  ".join(
                    f"{'/'.join(map(str, e.absolute_path)) or '(root)'}: {e.message}" for e in errors))
            pkg = doc["package"]
            if pkg["name"] in self.packages:
                raise ModelError(f"package {pkg['name']} declared in both "
                                 f"{self.packages[pkg['name']][1]} and {f}")
            self.packages[pkg["name"]] = (pkg, f)
            for kind in _DEF_KINDS:
                for d in pkg.get(kind, []):
                    if d["name"] in self.defs:
                        raise ModelError(f"{d['name']} declared in both {self.defs[d['name']][3]} and {f}")
                    self.defs[d["name"]] = (kind, d, pkg["name"], f)
        if not self.packages:
            raise ModelError(f"no SysML-shaped JSON files found on {search_path}")
        self._check_symbols()

    def visible(self, package: str) -> set[str]:
        """Names usable in a package: its own definitions and those of the
        packages it imports (X::*), plus the standard library."""
        pkg = self.packages[package][0]
        names = {n for n, d in self.defs.items() if d[2] == package} | _STDLIB
        for imp in pkg.get("imports", []):
            target = imp["name"].removesuffix("::*")
            if target in self.packages:
                names |= {n for n, d in self.defs.items() if d[2] == target}
            elif target.split("::")[0] not in _STDLIB_PKGS:
                raise ModelError(f"package {package}: import {imp['name']}: no such package on the search path")
        return names

    def _check_symbols(self) -> None:
        """Fail on unresolved references, e.g. a subsystem missing an IP import."""
        errors = []
        for pname, (pkg, f) in self.packages.items():
            vis = self.visible(pname)

            def need(ref, where):
                if ref.split("::")[-1] not in vis:
                    errors.append(f"{f.name}: {where}: '{ref}' is not defined or not imported")

            for kind in _DEF_KINDS:
                for d in pkg.get(kind, []):
                    for s in d.get("specializes", []):
                        need(s, f"{d['name']} :> {s}")
                    if "conjugateOf" in d:
                        need(d["conjugateOf"], f"{d['name']} conjugateOf")
                    for a in d.get("attributes", []):
                        need(a["type"], f"{d['name']}.{a['name']}")
                    for i in d.get("items", []) + d.get("parameters", []):
                        need(i["type"], f"{d['name']}.{i['name']}")
                    for u in d.get("parts", []) + d.get("ports", []) + d.get("performs", []):
                        if "type" in u:                    # an untyped port is allowed
                            need(u["type"], f"{d['name']}.{u['name']}")
                    for m in d.get("metadata", []):
                        need(m["type"], f"{d['name']} @{m['type']}")
                    for a in d.get("actions", []):
                        if "type" in a:
                            need(a["type"], f"{d['name']}.{a['name']}")
                        for i in a.get("parameters", []):
                            need(i["type"], f"{d['name']}.{a['name']}.{i['name']}")
        if errors:
            raise ModelError("unresolved references (missing import?):\n  " + "\n  ".join(errors))

    def get(self, name: str, kind: str, where: str) -> tuple[dict, Path]:
        entry = self.defs.get(name.split("::")[-1])
        if entry is None or entry[0] != kind:
            raise ModelError(f"{where}: {kind[:-1].replace('Def', ' def')} '{name}' not found")
        return entry[1], entry[3]


def _jport(model: _JsonModel, usage: dict, owner_path: str) -> Port:
    """Resolve a port usage into concrete signals (direction from this side, width)."""
    if "type" not in usage:
        raise ModelError(f"{owner_path}.{usage['name']}: the port has no port def yet "
                         f"(fine while exploring; HDL needs one)")
    pname = usage["type"].split("::")[-1]
    pdef, _ = model.get(pname, "portDefs", f"{owner_path}.{usage['name']}")
    flip = bool(usage.get("conjugated"))
    base = pname
    if "conjugateOf" in pdef:                   # SysML conjugation, written out: a role is ~base
        base = pdef["conjugateOf"].split("::")[-1]
        pdef, _ = model.get(base, "portDefs", f"port def {pname}")
        flip = not flip
    params: dict[str, object] = {}
    raw: list[tuple[str, str, object]] = []
    for a in pdef.get("attributes", []):
        if "direction" not in a:
            d = a.get("default")
            params[a["name"]] = d["expr"] if isinstance(d, dict) else d
            continue
        width = None
        if a["type"] == "LogicVector":
            if "width" not in a.get("redefines", {}):
                raise ModelError(f"{pname}.{a['name']}: LogicVector without a width")
            width = a["redefines"]["width"]
        elif a["type"] != "Logic":
            raise ModelError(f"{pname}.{a['name']}: signal type must be Logic or LogicVector, "
                             f"not {a['type']}")
        raw.append((a["direction"], a["name"], width))
    for k, v in usage.get("redefines", {}).items():   # parameter overrides on the port usage
        params[k] = v["expr"] if isinstance(v, dict) else v
    signals = []
    for d, n, w in raw:
        if isinstance(w, dict):
            w = _eval_width(w["expr"], params)
        signals.append(Signal(n, _FLIP[d] if flip else d, w))
    # a role port (Axi4StreamReceiver, conjugateOf Axi4StreamTransmitter) is reported as its
    # base type, conjugated, so both ends of a connection name the same port def
    declared = ("~" if usage.get("conjugated") else "") + pname
    # SysML: with a short name, the short name is the identifier and the name is readable text
    ident = usage.get("shortName") or usage["name"]
    title = usage["name"] if "shortName" in usage else ""
    return Port(ident, base, flip, signals, params,
                doc=usage.get("doc", ""), declared=declared, title=title)


def _jvalue(v):
    return v["expr"] if isinstance(v, dict) else v


def _jelaborate(model: _JsonModel, defn: dict, source_file: Path, name: str, path: str) -> Instance:
    gen_attrs = [a for a in defn.get("attributes", []) if a["name"] not in RESOURCE_ATTRS]
    spec = defn.get("specializes", [])
    inst = Instance(
        name=name,
        definition=defn["name"],
        kind=spec[0].split("::")[-1] if spec else None,
        metadata={m["type"].split("::")[-1]: {k: _jvalue(v) for k, v in m.get("values", {}).items()}
                  for m in defn.get("metadata", [])},
        generics={a["name"]: _jvalue(a.get("default")) for a in gen_attrs},
        generic_defaults={a["name"]: _jvalue(a.get("default")) for a in gen_attrs},
        generic_types={a["name"]: a["type"] for a in gen_attrs},
        ports=[_jport(model, p, path) for p in defn.get("ports", [])],
        connections=[tuple(c["ends"]) for c in defn.get("connections", [])],
        bindings=[tuple(b["ends"]) for b in defn.get("bindings", [])],
        path=path,
        source_file=source_file,
    )
    _resolve_sources(inst.metadata, inst.source_file)
    for part in defn.get("parts", []):
        sub, sub_file = model.get(part["type"], "partDefs", f"{path}/{part['name']}")
        child = _jelaborate(model, sub, sub_file, part["name"], f"{path}/{part['name']}")
        for k, v in part.get("redefines", {}).items():   # instance overrides
            child.generics[k] = _jvalue(v)
        m = part.get("multiplicity")
        child.count = m if isinstance(m, int) else 1
        inst.children.append(child)
    return inst


def _load_ir_json(search_path, top: str, instance_name: str | None = None) -> Instance:
    model = _JsonModel(search_path)
    entry = model.defs.get(top)
    if entry is None or entry[0] != "partDefs":
        raise ModelError(f"top-level definition '{top}' not found on the search path")
    name = instance_name or re.sub(r"(?<!^)(?=[A-Z])", "_", top).lower()
    return _jelaborate(model, entry[1], entry[3], name, name)


# ----------------------------------------------------------------------
# JSON export (for agents, diffs between commits, and caching)
# ----------------------------------------------------------------------
def to_dict(inst: Instance) -> dict:
    return {
        "instance": inst.name,
        "path": inst.path,
        "definition": inst.definition,
        "kind": inst.kind,
        "source_file": str(inst.source_file) if inst.source_file else None,
        "metadata": inst.metadata,
        "generics": inst.generics,
        "generic_defaults": inst.generic_defaults,
        "generic_types": inst.generic_types,
        "ports": [{"name": p.name, "type": p.type, "conjugated": p.conjugated,
                   "declared": p.declared, "title": p.title, "doc": p.doc,
                   "params": p.params, "signals": [vars(s) for s in p.signals]}
                  for p in inst.ports],
        "connections": [list(c) for c in inst.connections],
        "bindings": [list(b) for b in inst.bindings],
        "count": inst.count,
        "children": [to_dict(c) for c in inst.children],
    }


def check_model(search_path) -> None:
    """Load and check every model file on the search path (schema, names,
    imports) without elaborating; raises ModelError listing the problems."""
    _JsonModel(search_path)


def load_ir(search_path, top: str, instance_name: str | None = None) -> Instance:
    """Load the model on the search path and elaborate from definition `top`.

    search_path: a directory or a list of directories (searched recursively).
    """
    return _load_ir_json(search_path, top, instance_name)


def main(argv=None) -> int:
    import argparse
    import json
    import sys

    ap = argparse.ArgumentParser(prog="ha ir", description="Elaborate the model and dump the IR as JSON.")
    ap.add_argument("--path", action="append", dest="paths", metavar="DIR", required=True,
                    help="model search path directory; repeat for several")
    ap.add_argument("--top", required=True, help="top-level part definition, e.g. FpgaOne")
    ap.add_argument("--out", help="output JSON file (default: stdout)")
    a = ap.parse_args(argv)
    try:
        ir = to_dict(load_ir(a.paths, a.top))
    except ModelError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    text = json.dumps(ir, indent=2, default=str)
    if a.out:
        Path(a.out).write_text(text + "\n")
    else:
        print(text)
    return 0
