"""HA 2 server (`ha serve`): serves the editor and reads/writes the model's SysML-shaped JSON.

    ha serve --path examples/wifi_router            # then open http://127.0.0.1:8765

The model files are the source of truth (core/schema/sysml-json.schema.json);
this server is an editor for them, like SysON is for its model. It:
  - loads every model JSON file under the --path directories, with its layout
    sidecar (<file>.layout.json: columns and positions, never model data);
  - on save, validates a file against the schema and writes it in one canonical
    form (keys in schema order, 2-space indent), so an unchanged model saves
    byte-identical and diffs show only real changes;
  - checks the whole model with the core model loader (schema, names, imports).
It listens on 127.0.0.1 only and writes only the files it loaded (and their
sidecars).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from hdl_architect.core import model as core_model

ROOT = Path.cwd()                  # file ids are shown relative to where the server was started
STATIC = Path(__file__).resolve().parent / "static"

SCHEMA = json.loads(core_model.JSON_SCHEMA.read_text(encoding="utf-8"))
DEFS = SCHEMA["$defs"]
LOCK = threading.Lock()


# ---------------------------------------------------------------- canonical form
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
    if not props:                       # a map (values, redefines): keep the user's order
        return obj
    out = {}
    for k, s in props.items():
        if k in obj:
            t = _target(s)
            out[k] = canonical(obj[k], t) if t in DEFS and DEFS[t].get("properties") else obj[k]
    for k in obj:                       # anything the schema does not know (rejected by validation)
        if k not in out:
            out[k] = obj[k]
    return out


def keep_floats(new, old):
    """JavaScript writes 100000000.0 as 100000000: a number that was a float on
    disk stays a float (a Real must not turn into an Integer)."""
    if isinstance(new, dict) and isinstance(old, dict):
        return {k: keep_floats(v, old.get(k)) for k, v in new.items()}
    if isinstance(new, list) and isinstance(old, list):
        by_name = {o.get("name"): o for o in old if isinstance(o, dict) and "name" in o}
        return [keep_floats(n, by_name.get(n.get("name")) if isinstance(n, dict) and "name" in n
                            else (old[i] if i < len(old) else None)) for i, n in enumerate(new)]
    if isinstance(new, int) and not isinstance(new, bool) and isinstance(old, float):
        return float(new)          # it was a Real: it stays one, changed or not
    return new


def dump_model(doc: dict) -> str:
    doc = {"schemaVersion": doc.get("schemaVersion"), "package": canonical(doc.get("package"), "Package")}
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


def dump_layout(layout: dict) -> str:
    return json.dumps(layout, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


# ---------------------------------------------------------------- editor form
# In the file, a port with a readable name follows SysML: {"name": "Processing CSR",
# "shortName": "processing"} (the short name is the identifier). The editor works
# on identifiers, so it gets {"name": "processing", "label": "Processing CSR"};
# saving turns it back. Only these two functions know about the difference.
def _port_usages(doc: dict):
    def walk(pkg):
        for d in pkg.get("partDefs", []):
            yield from d.get("ports", [])
        for sub in pkg.get("packages", []):
            yield from walk(sub)
    if isinstance(doc, dict) and isinstance(doc.get("package"), dict):
        yield from walk(doc["package"])


def to_editor(doc: dict) -> dict:
    for u in _port_usages(doc):
        if "shortName" in u:
            u["label"], u["name"] = u["name"], u.pop("shortName")
    return doc


def to_file(doc: dict) -> dict:
    for u in _port_usages(doc):
        label = u.pop("label", None) if isinstance(u, dict) else None
        if isinstance(label, str) and label.strip() and label.strip() != u.get("name"):
            u["shortName"], u["name"] = u["name"], label.strip()
    return doc


# ---------------------------------------------------------------- the model on disk
class Store:
    def __init__(self, paths: list[Path]):
        import jsonschema
        self.paths = paths
        self.validator = jsonschema.Draft202012Validator(SCHEMA)
        self.files: dict[str, Path] = {}          # id (path relative to ROOT) -> file

    def scan(self) -> list[dict]:
        out = []
        self.files = {}
        for d in self.paths:
            for f in sorted(d.rglob("*.json")):
                if f.name.endswith(".layout.json"):
                    continue
                try:
                    doc = json.loads(f.read_text(encoding="utf-8"))
                except json.JSONDecodeError:
                    continue
                if not isinstance(doc, dict) or "schemaVersion" not in doc:
                    continue
                fid = str(f.resolve().relative_to(ROOT)) if f.resolve().is_relative_to(ROOT) else str(f.resolve())
                self.files[fid] = f
                lf = layout_file(f)
                layout = json.loads(lf.read_text(encoding="utf-8")) if lf.is_file() else None
                out.append({"file": fid, "model": to_editor(doc), "layout": layout,
                            "version": version(f), "layoutVersion": version(lf)})
        return out

    def errors(self, doc) -> list[str]:
        return [f"{'/'.join(map(str, e.absolute_path)) or '(root)'}: {e.message}"
                for e in sorted(self.validator.iter_errors(doc), key=lambda e: list(map(str, e.absolute_path)))]

    def save_model(self, fid: str, doc: dict, base) -> tuple[list[str], str | None]:
        f = self.files.get(fid)
        if f is None:
            return [f"{fid}: not a model file this server loaded"], None
        if stale(f, base):
            return [STALE], None
        doc = to_file(doc)
        errs = self.errors(doc)
        if errs:
            return errs, None
        try:
            doc = keep_floats(doc, json.loads(f.read_text(encoding="utf-8")))
        except json.JSONDecodeError:
            pass
        text = dump_model(doc)
        if f.read_text(encoding="utf-8") != text:
            tmp = f.with_suffix(".json.tmp")
            tmp.write_text(text, encoding="utf-8")
            tmp.replace(f)
        return [], version(f)

    def save_layout(self, fid: str, layout: dict, base) -> tuple[list[str], str | None]:
        f = self.files.get(fid)
        if f is None:
            return [f"{fid}: not a model file this server loaded"], None
        lf = layout_file(f)
        if stale(lf, base):
            return [STALE], None
        text = dump_layout(layout)
        if not lf.is_file() or lf.read_text(encoding="utf-8") != text:
            tmp = lf.with_suffix(".tmp")
            tmp.write_text(text, encoding="utf-8")
            tmp.replace(lf)
        return [], version(lf)

    def check(self) -> list[str]:
        try:
            core_model.check_model(self.paths)
        except core_model.ModelError as e:
            return [l.strip() for l in str(e).splitlines() if l.strip() and not l.strip().endswith(":")] or [str(e)]
        return []


STALE = "changed on disk since HA 2 loaded it (another program or tab wrote it); not saved. Reload HA 2 to pick up the change."


def version(f: Path) -> str:
    """What the browser last saw of a file: a hash of its bytes ("" if it does not exist)."""
    return hashlib.sha256(f.read_bytes()).hexdigest() if f.is_file() else ""


def stale(f: Path, base) -> bool:
    """A save is stale unless it says which version it edits and that is still the one on disk."""
    return not isinstance(base, str) or base != version(f)


def layout_file(f: Path) -> Path:
    return f.with_name(f.stem + ".layout.json")


# ---------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    store: Store

    def log_message(self, fmt, *args):          # quiet
        pass

    def _send(self, code: int, body: bytes, ctype: str):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code: int = 200):
        self._send(code, json.dumps(obj).encode("utf-8"), "application/json")

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/model":
            with LOCK:
                return self._json({"packages": self.store.scan()})
        if path == "/api/check":
            with LOCK:
                return self._json({"errors": self.store.check()})
        name = "index.html" if path in ("/", "/index.html") else path.removeprefix("/static/")
        f = (STATIC / name).resolve()
        if STATIC.resolve() not in f.parents or not f.is_file():
            return self._send(404, b"not found", "text/plain")
        ctype = {".html": "text/html", ".js": "text/javascript", ".css": "text/css"}.get(f.suffix, "text/plain")
        self._send(200, f.read_bytes(), ctype + "; charset=utf-8")

    def do_PUT(self):
        n = int(self.headers.get("Content-Length", "0"))
        try:
            body = json.loads(self.rfile.read(n).decode("utf-8"))
        except json.JSONDecodeError:
            return self._json({"errors": ["the request is not JSON"]}, 400)
        with LOCK:
            if self.path == "/api/file":
                errs, ver = self.store.save_model(body.get("file", ""), body.get("model"), body.get("base"))
            elif self.path == "/api/layout":
                errs, ver = self.store.save_layout(body.get("file", ""), body.get("layout") or {}, body.get("base"))
            else:
                return self._json({"errors": ["unknown endpoint"]}, 404)
        code = 200 if not errs else 409 if errs == [STALE] else 422
        self._json({"errors": errs, "version": ver, "stale": errs == [STALE]}, code)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="ha serve", description=__doc__.splitlines()[0])
    ap.add_argument("--path", action="append", required=True, metavar="DIR",
                    help="model search path directory (repeatable)")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--normalize", action="store_true",
                    help="rewrite every model file in canonical form, then exit (prints what changed)")
    args = ap.parse_args(argv)
    paths = [Path(p).resolve() for p in args.path]
    for p in paths:
        if not p.is_dir():
            print(f"error: {p} is not a directory")
            return 1
    store = Store(paths)
    if args.normalize:
        changed = 0
        for pkg in store.scan():
            f = store.files[pkg["file"]]
            text = dump_model(to_file(pkg["model"]))
            if f.read_text(encoding="utf-8") != text:
                f.write_text(text, encoding="utf-8")
                print(f"normalized {pkg['file']}")
                changed += 1
        print(f"{len(store.files)} model files, {changed} changed")
        return 0
    Handler.store = store
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"HA 2: http://127.0.0.1:{args.port}  ({len(store.scan())} model files)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
