"""`ha`: one command for the editor, the model and every generator.

    ha serve    --path DIR ...                 HA 2, the drawing editor
    ha check    --path DIR ...                 check the model (schema, names, imports)
    ha ir       --path DIR ... --top NAME      dump the elaborated IR as JSON
    ha gen NAME ...                            run a generator (ha gen --list)
    ha scaffold ...                            create or update a workspace
    ha connect [--sheet NAME] A B              wire two existing ports (a.p or p)
    ha set-interface DEF.PORT... --type T      set ports' interface (--none clears)

Generators are plugins: any installed package can add one through the
`hdl_architect.generators` entry point group (name = module:main), the way
PeakRDL finds its exporters.
"""

from __future__ import annotations

import sys
from importlib.metadata import entry_points

GROUP = "hdl_architect.generators"


def _generators() -> dict:
    return {ep.name: ep for ep in entry_points(group=GROUP)}


def _check(argv) -> int:
    import argparse
    from hdl_architect.core.model import ModelError, check_model

    ap = argparse.ArgumentParser(
        prog="ha check", description="Check every model file on the search path."
    )
    ap.add_argument(
        "--path", action="append", dest="paths", metavar="DIR", required=True
    )
    a = ap.parse_args(argv)
    try:
        check_model(a.paths)
    except ModelError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    print("model ok")
    return 0


def _connect(argv) -> int:
    """`ha connect`: the model operation HA 2 uses to wire two ports."""
    import argparse

    from hdl_architect.core import config, ops
    from hdl_architect.core.files import read_model_files, write_model_file
    from hdl_architect.core.model import ModelError

    ap = argparse.ArgumentParser(
        prog="ha connect",
        description="Wire two existing ports on a sheet: two component ports "
        "(part.port) get a connect, a sheet port and a component port a bind. "
        "Settings from ha.toml ([model] paths, top); options override it.",
    )
    ap.add_argument("a", help="first end: part.port, or a sheet port's name")
    ap.add_argument("b", help="second end")
    ap.add_argument(
        "--sheet", help="the part def whose sheet to wire (default: [model] top)"
    )
    ap.add_argument("--path", action="append", dest="paths", metavar="DIR")
    ap.add_argument("--config", help="settings file (default: ha.toml here or above)")
    a = ap.parse_args(argv)
    try:
        cfg, _ = config.load(a.config)
    except ModelError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    paths = a.paths or cfg.get("model", {}).get("paths")
    sheet = a.sheet or cfg.get("model", {}).get("top")
    if not paths or not sheet:
        print(
            "error: need --path and --sheet (or [model] paths and top in ha.toml)",
            file=sys.stderr,
        )
        return 2
    docs = read_model_files(paths)
    try:
        changed = ops.connect(ops.Model(docs), sheet, a.a, a.b).changed
    except ops.OpError as e:
        print(f"refused ({e.code}): {e.message}", file=sys.stderr)
        return 1
    for f in changed:
        write_model_file(f, docs[f])
    kind = "bind" if "." not in a.a or "." not in a.b else "connect"
    print(f"{kind} {a.a} {a.b} on {sheet}; wrote {', '.join(changed)}")
    return 0


def _set_interface(argv) -> int:
    """`ha set-interface`: the model operation behind HA 2's "Set interface"."""
    import argparse

    from hdl_architect.core import config, ops
    from hdl_architect.core.files import read_model_files, write_model_file
    from hdl_architect.core.model import ModelError

    ap = argparse.ArgumentParser(
        prog="ha set-interface",
        description="Set the interface (port def) of ports, given as Def.port. An "
        "untyped port wired to one on the sheet gets the matching interface too. "
        "Settings from ha.toml ([model] paths, top); options override it.",
    )
    ap.add_argument("ports", nargs="+", metavar="DEF.PORT")
    t = ap.add_mutually_exclusive_group(required=True)
    t.add_argument("--type", help="the port def, e.g. Axi4LiteSubordinate")
    t.add_argument("--none", action="store_true", help="remove the interface")
    ap.add_argument("--sheet", help="whose wires to follow (default: [model] top)")
    ap.add_argument("--path", action="append", dest="paths", metavar="DIR")
    ap.add_argument("--config", help="settings file (default: ha.toml here or above)")
    a = ap.parse_args(argv)
    try:
        cfg, _ = config.load(a.config)
    except ModelError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    paths = a.paths or cfg.get("model", {}).get("paths")
    if not paths:
        print("error: need --path (or [model] paths in ha.toml)", file=sys.stderr)
        return 2
    ports = []
    for x in a.ports:
        d, _, port = x.partition(".")
        if not port:
            ap.error(f"{x}: give ports as Def.port")
        ports.append((d, port))
    docs = read_model_files(paths)
    sheet = a.sheet or cfg.get("model", {}).get("top")
    try:
        result = ops.set_interface(
            ops.Model(docs), ports, None if a.none else a.type, sheet
        )
    except ops.OpError as e:
        print(f"refused ({e.code}): {e.message}", file=sys.stderr)
        return 1
    for f in result.changed:
        write_model_file(f, docs[f])
    print(f"set {len(ports)} port(s); wrote {', '.join(result.changed)}")
    for n in result.notes:
        print(n)
    return 0


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    cmd, rest = argv[0], argv[1:]
    if cmd == "serve":
        from hdl_architect.editor.server import main as run

        return run(rest)
    if cmd == "check":
        return _check(rest)
    if cmd == "ir":
        from hdl_architect.core.model import main as run

        return run(rest)
    if cmd == "connect":
        return _connect(rest)
    if cmd == "set-interface":
        return _set_interface(rest)
    if cmd == "scaffold":
        from hdl_architect.flow.scaffold import main as run

        return run(rest)
    if cmd == "gen":
        gens = _generators()
        if not rest or rest[0] in ("--list", "-h", "--help"):
            print("generators:", ", ".join(sorted(gens)) or "(none installed)")
            return 0
        if rest[0] not in gens:
            print(
                f"error: no generator '{rest[0]}' (installed: "
                f"{', '.join(sorted(gens))})",
                file=sys.stderr,
            )
            return 2
        return gens[rest[0]].load()(rest[1:])
    print(f"error: unknown command '{cmd}' (ha --help)", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
