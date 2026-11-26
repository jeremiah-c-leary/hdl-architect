"""`ha`: one command for the editor, the model and every generator.

    ha serve    --path DIR ...                 HA 2, the drawing editor
    ha check    --path DIR ...                 check the model (schema, names, imports)
    ha ir       --path DIR ... --top NAME      dump the elaborated IR as JSON
    ha gen NAME ...                            run a generator (ha gen --list)
    ha scaffold ...                            create or update a workspace
    ha report resources                        estimates vs the target device
    ha report devices                          the design on every device of the family
    ha connect [--sheet NAME] A B              wire two existing ports (a.p or p)
    ha set-interface DEF.PORT... --type T      set ports' interface (--none clears)
    ha add-port DEF.PORT [--type T]            add a port
    ha rename-port DEF.OLD NEW                 rename a port, and its wires and pairings
    ha delete-port DEF.PORT                    delete a port, its wires and pairings
    ha add-part SHEET.PART --kind K|--def D    add a part (a new def of kind K, or of D)
    ha rename-part SHEET.OLD NEW               rename a part, and its wires
    ha delete-part SHEET.PART                  delete a part and its wires
    ha rename-def OLD NEW                      rename a definition everywhere
    ha set-def SHEET.PART DEF                  make a part another def
    ha set-kind DEF KIND                       make a def another kind
    ha op NAME key=value ...                   any model operation (ha op --list)

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


# ---------------------------------------------------------------- model operations
# Each `ha <op>` command runs one core.ops operation on the model files: the
# same rules HA 2 uses. Settings from ha.toml ([model] paths, top); options
# override it. Every command shares _run_op: load, run, write, report.
def _op_parser(prog: str, description: str):
    import argparse

    ap = argparse.ArgumentParser(
        prog=f"ha {prog}",
        description=description + " Settings from ha.toml ([model] paths, top); "
        "options override it.",
    )
    ap.add_argument("--path", action="append", dest="paths", metavar="DIR")
    ap.add_argument("--config", help="settings file (default: ha.toml here or above)")
    return ap


def _run_op(a, call) -> int:
    """Load the model, run `call(model, args, cfg)`, write what changed."""
    from hdl_architect.core import config, ops
    from hdl_architect.core.files import read_model_files, write_model_file
    from hdl_architect.core.model import ModelError

    try:
        cfg, _ = config.load(a.config)
    except ModelError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    model_cfg = cfg.get("model", {})
    paths = a.paths or model_cfg.get("paths")
    if not paths:
        print("error: need --path (or [model] paths in ha.toml)", file=sys.stderr)
        return 2
    docs = read_model_files(paths)
    try:
        result = call(ops.Model(docs), a, model_cfg)
    except ops.OpError as e:
        print(f"refused ({e.code}): {e.message}", file=sys.stderr)
        return 1
    for f in result.changed:
        write_model_file(f, docs[f])
    print(f"wrote {', '.join(result.changed) or 'nothing'}")
    for n in result.notes:
        print(n)
    return 0


def _def_port(ap, text: str) -> tuple[str, str]:
    d, _, port = text.partition(".")
    if not port:
        ap.error(f"{text}: give a port as Def.port")
    return d, port


def _op_command(cmd: str, argv) -> int:
    from hdl_architect.core import ops

    def sheet(a, cfg):
        if not (a.sheet or cfg.get("top")):
            raise ops.OpError("bad_request", "need --sheet (or [model] top in ha.toml)")
        return a.sheet or cfg.get("top")

    if cmd == "connect":
        ap = _op_parser(
            "connect",
            "Wire two existing ports on a sheet: two component ports (part.port) get "
            "a connect, a sheet port and a component port a bind.",
        )
        ap.add_argument("a", help="first end: part.port, or a sheet port's name")
        ap.add_argument("b", help="second end")
        ap.add_argument(
            "--sheet", help="the part def whose sheet (default: [model] top)"
        )
        a = ap.parse_args(argv)
        return _run_op(a, lambda m, a, cfg: ops.connect(m, sheet(a, cfg), a.a, a.b))
    if cmd == "set-interface":
        ap = _op_parser(
            "set-interface",
            "Set the interface (port def) of ports, given as Def.port. An untyped "
            "port wired to one on the sheet gets the matching interface too.",
        )
        ap.add_argument("ports", nargs="+", metavar="DEF.PORT")
        t = ap.add_mutually_exclusive_group(required=True)
        t.add_argument("--type", help="the port def, e.g. Axi4LiteSubordinate")
        t.add_argument("--none", action="store_true", help="remove the interface")
        ap.add_argument("--sheet", help="whose wires to follow (default: [model] top)")
        a = ap.parse_args(argv)
        ports = [_def_port(ap, x) for x in a.ports]
        return _run_op(
            a,
            lambda m, a, cfg: ops.set_interface(
                m, ports, None if a.none else a.type, a.sheet or cfg.get("top")
            ),
        )
    if cmd == "add-port":
        ap = _op_parser("add-port", "Add a port to a part def (Def.port).")
        ap.add_argument("port", metavar="DEF.PORT")
        ap.add_argument("--type", help="its interface (a port def)")
        a = ap.parse_args(argv)
        d, port = _def_port(ap, a.port)
        return _run_op(a, lambda m, a, cfg: ops.add_port(m, d, port, a.type))
    if cmd == "rename-port":
        ap = _op_parser(
            "rename-port",
            "Rename a port (Def.old -> new) and every wire and clock pairing that "
            "refers to it.",
        )
        ap.add_argument("port", metavar="DEF.OLD")
        ap.add_argument("new")
        a = ap.parse_args(argv)
        d, old = _def_port(ap, a.port)
        return _run_op(a, lambda m, a, cfg: ops.rename_port(m, d, old, a.new))
    if cmd == "delete-port":
        ap = _op_parser(
            "delete-port",
            "Delete a port (Def.port), every wire to it and any clock pairing that "
            "names it.",
        )
        ap.add_argument("port", metavar="DEF.PORT")
        a = ap.parse_args(argv)
        d, port = _def_port(ap, a.port)
        return _run_op(a, lambda m, a, cfg: ops.delete_port(m, d, port))
    if cmd == "add-part":
        ap = _op_parser(
            "add-part",
            "Add a part to a sheet: of an existing part def (--def), or of a new part "
            "def of a kind (--kind Rtl, Subsystem, ...), named after the part.",
        )
        ap.add_argument("part", metavar="SHEET.PART")
        k = ap.add_mutually_exclusive_group(required=True)
        k.add_argument("--kind")
        k.add_argument("--def", dest="def_name")
        a = ap.parse_args(argv)
        sh, name = _def_port(ap, a.part)
        return _run_op(
            a, lambda m, a, cfg: ops.add_part(m, sh, name, a.kind, a.def_name)
        )
    if cmd == "rename-part":
        ap = _op_parser(
            "rename-part", "Rename a part (SHEET.OLD -> new) and its wires."
        )
        ap.add_argument("part", metavar="SHEET.OLD")
        ap.add_argument("new")
        a = ap.parse_args(argv)
        sh, old = _def_port(ap, a.part)
        return _run_op(a, lambda m, a, cfg: ops.rename_part(m, sh, old, a.new))
    if cmd == "delete-part":
        ap = _op_parser("delete-part", "Delete a part (SHEET.PART) and its wires.")
        ap.add_argument("part", metavar="SHEET.PART")
        a = ap.parse_args(argv)
        sh, name = _def_port(ap, a.part)
        return _run_op(a, lambda m, a, cfg: ops.delete_part(m, sh, name))
    if cmd == "rename-def":
        ap = _op_parser(
            "rename-def", "Rename a definition and every reference to it in the model."
        )
        ap.add_argument("old")
        ap.add_argument("new")
        a = ap.parse_args(argv)
        return _run_op(a, lambda m, a, cfg: ops.rename_def(m, a.old, a.new))
    if cmd == "set-def":
        ap = _op_parser(
            "set-def",
            "Make a part (SHEET.PART) another part def; wires to ports the new def "
            "lacks are removed.",
        )
        ap.add_argument("part", metavar="SHEET.PART")
        ap.add_argument("def_name", metavar="DEF")
        a = ap.parse_args(argv)
        sh, name = _def_port(ap, a.part)
        return _run_op(a, lambda m, a, cfg: ops.set_part_def(m, sh, name, a.def_name))
    if cmd == "set-kind":
        ap = _op_parser(
            "set-kind", "Make a part def of another kind (Rtl, Subsystem, ...)."
        )
        ap.add_argument("def_name", metavar="DEF")
        ap.add_argument("kind")
        a = ap.parse_args(argv)
        return _run_op(a, lambda m, a, cfg: ops.set_kind(m, a.def_name, a.kind))
    raise KeyError(cmd)


def _op_generic(argv) -> int:
    """`ha op NAME key=value ...`: any model operation, by name (core.ops)."""
    import json

    from hdl_architect.core import ops

    ap = _op_parser(
        "op",
        "Run any model operation by name (the operations HA 2 uses): "
        "ha op NAME key=value ... A value is read as JSON when it parses (numbers, "
        "true, null, lists), else as text; a missing `sheet` is [model] top. "
        "ha op --list lists the operations and their arguments.",
    )
    ap.add_argument("name", nargs="?")
    ap.add_argument("args", nargs="*", metavar="KEY=VALUE")
    ap.add_argument("--list", action="store_true", help="list the operations")
    a = ap.parse_args(argv)
    if a.list or not a.name:
        for n, (_, req, opt) in sorted(ops.OPERATIONS.items()):
            print(f"  {n:16} {' '.join(req + ['[' + o + ']' for o in opt])}")
        return 0
    args = {}
    for kv in a.args:
        k, eq, v = kv.partition("=")
        if not eq:
            ap.error(f"{kv}: give arguments as key=value")
        try:
            args[k] = json.loads(v)
        except json.JSONDecodeError:
            args[k] = v

    def call(m, _a, cfg):
        required = ops.OPERATIONS.get(a.name, (None, [], []))[1]
        if "sheet" in required and "sheet" not in args and cfg.get("top"):
            args["sheet"] = cfg["top"]
        return ops.run(m, a.name, args)

    return _run_op(a, call)


OP_COMMANDS = (
    "connect",
    "set-interface",
    "add-port",
    "rename-port",
    "delete-port",
    "add-part",
    "rename-part",
    "delete-part",
    "rename-def",
    "set-def",
    "set-kind",
)


REPORTS = {
    "resources": "hdl_architect.reports.resources",
    "devices": "hdl_architect.reports.devices",
}


def _report(argv) -> int:
    """`ha report NAME`: print what the model says; no files are written."""
    from importlib import import_module

    if not argv or argv[0] not in REPORTS:
        print(f"usage: ha report {{{','.join(sorted(REPORTS))}}} ...", file=sys.stderr)
        return 2
    return import_module(REPORTS[argv[0]]).main(argv[1:])


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
    if cmd in OP_COMMANDS:
        return _op_command(cmd, rest)
    if cmd == "op":
        return _op_generic(rest)
    if cmd == "report":
        return _report(rest)
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
