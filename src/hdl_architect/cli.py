"""`ha`: one command for the editor, the model and every generator.

    ha serve    --path DIR ...                 HA 2, the drawing editor
    ha check    --path DIR ...                 check the model (schema, names, imports)
    ha ir       --path DIR ... --top NAME      dump the elaborated IR as JSON
    ha gen NAME ...                            run a generator (ha gen --list)
    ha scaffold ...                            create or update a workspace

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
    ap = argparse.ArgumentParser(prog="ha check", description="Check every model file on the search path.")
    ap.add_argument("--path", action="append", dest="paths", metavar="DIR", required=True)
    a = ap.parse_args(argv)
    try:
        check_model(a.paths)
    except ModelError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    print("model ok")
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
    if cmd == "scaffold":
        from hdl_architect.flow.scaffold import main as run
        return run(rest)
    if cmd == "gen":
        gens = _generators()
        if not rest or rest[0] in ("--list", "-h", "--help"):
            print("generators:", ", ".join(sorted(gens)) or "(none installed)")
            return 0
        if rest[0] not in gens:
            print(f"error: no generator '{rest[0]}' (installed: {', '.join(sorted(gens))})", file=sys.stderr)
            return 2
        return gens[rest[0]].load()(rest[1:])
    print(f"error: unknown command '{cmd}' (ha --help)", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
