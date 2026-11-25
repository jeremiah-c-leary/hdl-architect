"""Generate SysML v2 text from the model's SysML-shaped JSON (schema/sysml-json.schema.json).

    ha gen sysml --path lib --path ip --path subsystems --path fpgas [--out gen/sysml]
    ha gen sysml FILE.json [...] --out DIR

The JSON is the source of truth; the SysML text is an output (for SysON,
for readers, and for anyone who wants SysML). Writes <out>/<package>.sysml
for every model file found (generated: never edit by hand, change the JSON).
A pretty-printer: one JSON object becomes one SysML
element, in the order given, with no reasoning. The one expansion:
`conjugateOf` is written out as explicit features (attributes and items) with
in and out swapped (convention: no ~ in the text).

Each input is validated against the schema first. Problems are reported as
errors and the exit code is 1; nothing is written for an invalid input.
"""
from __future__ import annotations

import argparse
import json
import sys
import textwrap
from pathlib import Path

import jsonschema

from hdl_architect.core.model import JSON_SCHEMA as SCHEMA  # noqa: E402
SWAP = {"in": "out", "out": "in", "inout": "inout"}
IND = "    "


def doc(text: str, indent: str) -> list[str]:
    """`doc /* text */`, wrapped at 79 columns with ` * ` continuation lines."""
    width = max(40, 79 - len(indent) - 7)
    parts = textwrap.wrap(text, width) or [""]
    if len(parts) == 1:
        return [f"{indent}doc /* {parts[0]} */"]
    return ([f"{indent}doc /* {parts[0]}"] + [f"{indent}     * {p}" for p in parts[1:-1]]
            + [f"{indent}     * {parts[-1]} */"])


def value(v) -> str:
    if isinstance(v, list):
        return "(" + ", ".join(value(x) for x in v) + ")"
    if isinstance(v, dict):
        return v["expr"]
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, str):
        return '"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return repr(v)


def attribute(a: dict, indent: str) -> list[str]:
    head = f"{a['direction']} " if "direction" in a else ""
    line = f"{indent}{head}attribute {a['name']} : {a['type']}" + mult(a)
    if "default" in a:
        line += f" default {value(a['default'])}"
    body = []
    if "doc" in a:
        body += doc(a["doc"], indent + IND)
    for name, v in a.get("redefines", {}).items():
        body.append(f"{indent}{IND}attribute :>> {name} = {value(v)};")
    if not body:
        return [line + ";"]
    return [line + " {"] + body + [f"{indent}}}"]


def mult(u: dict) -> str:
    return f"[{u['multiplicity']}]" if "multiplicity" in u else ""


def conjugate(attrs: list[dict]) -> list[dict]:
    return [dict(a, direction=SWAP[a["direction"]]) if "direction" in a else dict(a) for a in attrs]


def item(i: dict, indent: str) -> list[str]:
    line = f"{indent}{i['direction']} item {i['name']} : {i['type']}"
    return [line + ";"] if "doc" not in i else [line + " {"] + doc(i["doc"], indent + IND) + [f"{indent}}}"]


def definition(keyword: str, d: dict, attrs: list[dict], indent: str, items: list[dict] = ()) -> list[str]:
    body = (doc(d["doc"], indent + IND) if "doc" in d else [])
    for a in attrs:
        body += attribute(a, indent + IND)
    for i in items:
        body += item(i, indent + IND)
    if not body:
        return [f"{indent}{keyword} {d['name']};"]
    return [f"{indent}{keyword} {d['name']} {{"] + body + [f"{indent}}}"]


def comment(text: str, indent: str) -> list[str]:
    return [l.replace("doc /*", "comment /*", 1) if i == 0 else l.replace("     * ", "         * ", 1)
            for i, l in enumerate(doc(text, indent))]


def redefinitions(values: dict, indent: str) -> list[str]:
    return [f"{indent}attribute :>> {k} = {value(v)};" for k, v in values.items()]


def usage(keyword: str, u: dict, indent: str) -> list[str]:
    typ = f" : {'~' if u.get('conjugated') else ''}{u['type']}" if "type" in u else ""   # untyped: `port p;`
    head = f"{indent}{'abstract ' if u.get('isAbstract') else ''}{keyword} {u['name']}{typ}{mult(u)}"
    if u.get("subsets"):
        head += " :> " + ", ".join(u["subsets"])
    body = (doc(u["doc"], indent + IND) if "doc" in u else []) + redefinitions(u.get("redefines", {}), indent + IND)
    return [head + ";"] if not body else [head + " {"] + body + [f"{indent}}}"]


def constraint(c: dict, indent: str) -> list[str]:
    body = (doc(c["doc"], indent + IND) if "doc" in c else []) + [f"{indent}{IND}{c['expr']}"]
    return [f"{indent}{'assert ' if c.get('assert') else ''}constraint {c['name']} {{"] + body + [f"{indent}}}"]


def part_def(d: dict, indent: str) -> list[str]:
    i2 = indent + IND
    head = f"{indent}{'abstract ' if d.get('isAbstract') else ''}part def {d['name']}"
    if d.get("specializes"):
        head += " :> " + ", ".join(d["specializes"])
    body = doc(d["doc"], i2) if "doc" in d else []
    for c in d.get("comments", []):
        body += comment(c, i2)
    for m in d.get("metadata", []):
        vals = [f"{k} = {value(v)};" for k, v in m.get("values", {}).items()]
        one = f"{i2}@{m['type']}" + (f" {{ {' '.join(vals)} }}" if vals else ";")
        if len(one) <= 79:
            body.append(one)
        else:   # one value per line
            body += [f"{i2}@{m['type']} {{"] + [f"{i2}{IND}{v}" for v in vals] + [f"{i2}}}"]
    groups = [
        [l for a in d.get("attributes", []) for l in attribute(a, i2)]
        + redefinitions(d.get("redefines", {}), i2),
        [l for c in d.get("constraints", []) for l in constraint(c, i2)],
        [l for p in d.get("parts", []) for l in usage("part", p, i2)],
        [f"{i2}bind {b['ends'][0]} = {b['ends'][1]};" for b in d.get("bindings", [])],
        [f"{i2}connect {c['ends'][0]} to {c['ends'][1]};" for c in d.get("connections", [])],
        [f"{i2}perform action {p['name']} : {p['type']};" for p in d.get("performs", [])]
        + [f"{i2}allocate {a['from']} to {a['to']};" for a in d.get("allocations", [])],
        [l for p in d.get("ports", []) for l in usage("port", p, i2)],
    ]
    for g in groups:
        if g:
            body += ([""] if body else []) + g
    return [head + ";"] if not body else [head + " {"] + body + [f"{indent}}}"]


def action_def(d: dict, indent: str) -> list[str]:
    i2, i3 = indent + IND, indent + IND + IND
    body = doc(d["doc"], i2) if "doc" in d else []
    for c in d.get("comments", []):
        body += comment(c, i2)
    body += [l for p in d.get("parameters", []) for l in item(p, i2)]
    for a in d.get("actions", []):
        head = f"{i2}action {a['name']}" + (f" : {a['type']}" if "type" in a else "")
        inner = (doc(a["doc"], i3) if "doc" in a else []) + [l for p in a.get("parameters", []) for l in item(p, i3)]
        body += [""] + ([head + ";"] if not inner else [head + " {"] + inner + [f"{i2}}}"])
    tail = [f"{i2}bind {b['ends'][0]} = {b['ends'][1]};" for b in d.get("bindings", [])]
    tail += [f"{i2}{'succession ' if f.get('succession') else ''}flow from {f['from']} to {f['to']};"
             for f in d.get("flows", [])]
    if tail:
        body += [""] + tail
    return [f"{indent}action def {d['name']};"] if not body else \
        [f"{indent}action def {d['name']} {{"] + body + [f"{indent}}}"]


def package(pkg: dict) -> tuple[list[str], list[str]]:
    errors = []
    lines = ["// generated by `ha gen sysml` from SysML-shaped JSON - DO NOT EDIT: change the JSON",
             f"package {pkg['name']} {{"]
    if "doc" in pkg:
        lines += doc(pkg["doc"], IND)
    for c in pkg.get("comments", []):
        lines += comment(c, IND)
    for imp in pkg.get("imports", []):
        lines.append(f"{IND}{imp.get('visibility', 'private')} import {imp['name']};")
    for ad in pkg.get("attributeDefs", []):
        lines += [""] + definition("attribute def", ad, ad.get("attributes", []), IND)
    for it in pkg.get("itemDefs", []):
        lines += [""] + definition("item def", it, it.get("attributes", []), IND)
    for md in pkg.get("metadataDefs", []):
        lines += [""] + definition("metadata def", md, md.get("attributes", []), IND)
    by_name = {p["name"]: p for p in pkg.get("portDefs", [])}
    for pd in pkg.get("portDefs", []):
        if "conjugateOf" in pd:
            base = by_name.get(pd["conjugateOf"])
            if base is None:
                errors.append(f"port def {pd['name']}: conjugateOf {pd['conjugateOf']} is not in this package")
                continue
            if "conjugateOf" in base:
                errors.append(f"port def {pd['name']}: conjugateOf {base['name']}, which is itself a conjugate")
                continue
            attrs, items = conjugate(base.get("attributes", [])), conjugate(base.get("items", []))
        else:
            attrs, items = pd.get("attributes", []), pd.get("items", [])
        lines += [""] + definition("port def", pd, attrs, IND, items)
    for pd in pkg.get("partDefs", []):
        lines += [""] + part_def(pd, IND)
    for ad in pkg.get("actionDefs", []):
        lines += [""] + action_def(ad, IND)
    lines.append("}")
    names = [d["name"] for k in ("attributeDefs", "itemDefs", "metadataDefs", "portDefs", "partDefs", "actionDefs")
             for d in pkg.get(k, [])]
    errors += [f"{n}: declared twice" for n in sorted({n for n in names if names.count(n) > 1})]
    return lines, errors


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="ha gen sysml", description=__doc__.splitlines()[0])
    ap.add_argument("inputs", nargs="*", help="model JSON files")
    ap.add_argument("--path", action="append", default=[], metavar="DIR",
                    help="search path directory: every model JSON file under it (repeatable)")
    ap.add_argument("--out", default="gen/sysml", help="output directory (default: gen/sysml)")
    args = ap.parse_args(argv)
    validator = jsonschema.Draft202012Validator(json.loads(SCHEMA.read_text(encoding="utf-8")))
    out = Path(args.out)
    files = [Path(f) for f in args.inputs]
    for d in args.path:
        files += sorted(Path(d).rglob("*.json"))
    if not files:
        ap.error("no model files: give JSON files or --path")
    failed = False
    for f in files:
        model = json.loads(Path(f).read_text(encoding="utf-8"))
        if not isinstance(model, dict) or "schemaVersion" not in model:
            continue                                   # not a model file
        errors = [f"{'/'.join(map(str, e.absolute_path)) or '(root)'}: {e.message}"
                  for e in sorted(validator.iter_errors(model), key=lambda e: list(map(str, e.absolute_path)))]
        if not errors:
            lines, errors = package(model["package"])
        if errors:
            failed = True
            for e in errors:
                print(f"error: {f}: {e}")
            continue
        out.mkdir(parents=True, exist_ok=True)
        target = out / f"{model['package']['name']}.sysml"
        target.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"wrote {target}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
