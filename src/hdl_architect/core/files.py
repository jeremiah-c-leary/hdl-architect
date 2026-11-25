"""Model files: reading them, and writing them in one canonical form.

Every program that writes a model file (HA 2's server, the `ha` commands) uses
dump_model, so an unchanged model is written byte-identical and diffs show only
real changes: keys in the schema's order, 2-space indent.
"""

from __future__ import annotations

import json
from pathlib import Path

from hdl_architect.core.model import JSON_SCHEMA

DEFS = json.loads(JSON_SCHEMA.read_text(encoding="utf-8"))["$defs"]


def _target(prop_schema: dict) -> str | None:
    """The $def a property's value (or its array items) refers to."""
    ref = prop_schema.get("$ref") or (prop_schema.get("items") or {}).get("$ref")
    return ref.rsplit("/", 1)[-1] if ref else None


def canonical(obj, def_name: str):
    """Reorder an object's keys into the schema's property order, recursively."""
    if isinstance(obj, list):
        return [canonical(x, def_name) for x in obj]
    if not isinstance(obj, dict):
        return obj
    props = DEFS.get(def_name, {}).get("properties")
    if not props:  # a map (values, redefines): keep the user's order
        return obj
    out = {}
    for k, s in props.items():
        if k in obj:
            t = _target(s)
            out[k] = (
                canonical(obj[k], t)
                if t in DEFS and DEFS[t].get("properties")
                else obj[k]
            )
    for k in obj:  # anything the schema does not know (rejected by validation)
        if k not in out:
            out[k] = obj[k]
    return out


def dump_model(doc: dict) -> str:
    doc = {
        "schemaVersion": doc.get("schemaVersion"),
        "package": canonical(doc.get("package"), "Package"),
    }
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


def read_model_files(search_path) -> dict[str, dict]:
    """Every model file (a .json with a schemaVersion, not a layout) under the
    directories, by path: {path: document}."""
    if isinstance(search_path, (str, Path)):
        search_path = [search_path]
    out = {}
    for d in map(Path, search_path):
        for f in sorted(d.rglob("*.json")):
            if f.name.endswith(".layout.json"):
                continue
            try:
                doc = json.loads(f.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            if isinstance(doc, dict) and "schemaVersion" in doc:
                out[str(f)] = doc
    return out


def write_model_file(path, doc: dict) -> bool:
    """Write `doc` in canonical form; True if the file changed."""
    p = Path(path)
    text = dump_model(doc)
    if p.is_file() and p.read_text(encoding="utf-8") == text:
        return False
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(p)
    return True
