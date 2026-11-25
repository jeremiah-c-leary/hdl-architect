"""hdl_architect.flow.scaffold (`ha scaffold`): model JSON + team Copier templates -> workspace.

    cd examples/wifi_router && ha scaffold            # settings from ha.toml
    ha scaffold --config examples/wifi_router/ha.toml

A flow, not a generator: it runs Copier and calls the VHDL generator, so it
may import generators (generators may not import each other). First version,
carried over from the spike10 trial.

- New workspace: applies the project template (folders, fusesoc.conf, answers).
- Finds existing cores anywhere under WS (a core belongs to a block by name:
  vendor:library:<snake name of the definition>).
- Rtl block with no core: applies the rtl-block template once, then writes the
  entity skeleton from the model's ports. Never touches it again.
- Container (Subsystem, FpgaPart): applies the subsystem template once (folder),
  then regenerates gen/<entity>.vhd and gen/<entity>.core every run.
- Anything else with no core: reported as missing.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

import yaml

from hdl_architect.core import config
from hdl_architect.core.model import ModelError, load_ir
from hdl_architect.generators.vhdl import entity_name, skeleton, structural

CONTAINERS = {"Subsystem", "FpgaPart", "Fpga"}


def copier(template: Path, dst: Path, data: dict) -> None:
    args = ["copier", "copy", "--quiet", "--defaults", "--vcs-ref", "HEAD", str(template), str(dst)]
    for k, v in data.items():
        args += ["--data", f"{k}={v}"]
    subprocess.run(args, check=True)


def find_cores(ws: Path) -> dict[str, tuple[Path, dict]]:
    """vendor:library:name (no version) -> (core file, parsed core)."""
    out = {}
    for f in ws.rglob("*.core"):
        if "build" in f.parts:
            continue
        core = yaml.safe_load(f.read_text().split("\n", 1)[1])
        out[":".join(core["name"].split(":")[:3])] = (f, core)
    return out


def logical_name(core: dict) -> str | None:
    for fs in core.get("filesets", {}).values():
        if "logical_name" in fs:
            return fs["logical_name"]
    return None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        prog="ha scaffold",
        description="Create or update a workspace from the model and team Copier templates. "
                    "Settings come from ha.toml ([model], [scaffold]); options override it.")
    ap.add_argument("--config", help="settings file (default: ha.toml here or in a parent directory)")
    ap.add_argument("--path", action="append", help="model search path directory (repeatable)")
    ap.add_argument("--top", help="top-level part def")
    ap.add_argument("--ws", help="workspace directory")
    ap.add_argument("--templates", help="Copier templates directory")
    ap.add_argument("--project", help="project name, used by the first scaffold")
    args = ap.parse_args(argv)
    try:
        cfg, cfg_file = config.load(args.config)
    except ModelError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    model, sc = cfg.get("model", {}), cfg.get("scaffold", {})
    paths = args.path or model.get("paths")
    top_name = args.top or model.get("top")
    ws_dir = args.ws or sc.get("workspace")
    tpl_dir = args.templates or sc.get("templates")
    project = args.project or sc.get("project")
    missing = [n for n, v in (("[model] paths / --path", paths), ("[model] top / --top", top_name),
                              ("[scaffold] workspace / --ws", ws_dir),
                              ("[scaffold] templates / --templates", tpl_dir)) if not v]
    if missing:
        where = f"in {cfg_file}" if cfg_file else "(no ha.toml found here or above)"
        print(f"error: missing {', '.join(missing)} {where}", file=sys.stderr)
        return 2
    if cfg_file:
        print(f"settings: {cfg_file}")
    ws, tpl = Path(ws_dir), Path(tpl_dir).resolve()

    try:
        top = load_ir(paths, top_name)
    except ModelError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    if not (ws / ".copier-answers.yml").is_file():
        copier(tpl / "project", ws, {"project": project or entity_name(top_name)})
    ans = yaml.safe_load((ws / ".copier-answers.yml").read_text())
    vendor, library = ans["vendor"], ans["library"]
    place = {"Rtl": ans["rtl_dir"], "Subsystem": ans["subsystem_dir"],
             "VendorIp": ans["vendor_ip_dir"], "FpgaPart": ans["fpga_dir"], "Fpga": ans["fpga_dir"]}

    cores = find_cores(ws)
    status, problems, seen = [], [], set()
    for inst in top.walk_post():                       # children first: their libraries are known
        if inst.definition in seen:
            continue
        seen.add(inst.definition)
        ent = entity_name(inst.definition)
        key = f"{vendor}:{library}:{ent}"
        lib = f"{ent}_lib"
        if inst.kind in CONTAINERS:
            folder = cores[key][0].parent.parent if key in cores else ws / place[inst.kind] / ent
            if not folder.is_dir():
                copier(tpl / "subsystem", folder, {"name": inst.definition, "entity": ent})
                what = "created (folder from template)"
            else:
                what = "ok"
            # its children's libraries come from their cores, not from the model
            for c in inst.children:
                ckey = f"{vendor}:{library}:{entity_name(c.definition)}"
                if ckey in cores:
                    c.metadata["HdlSource"] = {"vhdl_library": logical_name(cores[ckey][1])}
            text, probs = structural(inst)
            problems += [f"{inst.definition}: {p}" for p in probs]
            gen = folder / "gen"
            gen.mkdir(exist_ok=True)
            (gen / f"{ent}.vhd").write_text("\n".join(text))
            deps = sorted({f"{vendor}:{library}:{entity_name(c.definition)}" for c in inst.children})
            core = {"name": f"{key}:0.1.0",
                    "description": f"{inst.definition} ({inst.kind}). Generated by the scaffolder every run; do not edit.",
                    # the top stays in the default library: Edalize's GHDL flow elaborates it there
                    "filesets": {"rtl": {"files": [f"{ent}.vhd"], "file_type": "vhdlSource-2008",
                                         **({} if inst is top else {"logical_name": lib}),
                                         **({"depend": deps} if deps else {})}},
                    "targets": {"default": {"filesets": ["rtl"], "toplevel": ent}}}
            if inst is top:
                core["targets"]["sim"] = {"filesets": ["rtl"], "toplevel": ent, "flow": "sim",
                                          "flow_options": {"tool": "ghdl"}}
                core["targets"]["synth"] = {"filesets": ["rtl"], "toplevel": ent, "default_tool": "vivado",
                                            "tools": {"vivado": {"part": ans["fpga_part"]}}}
            (gen / f"{ent}.core").write_text("CAPI=2:\n" + yaml.safe_dump(core, sort_keys=False))
            cores[key] = (gen / f"{ent}.core", core)
            status.append((inst.definition, inst.kind, folder, what + "; gen/ regenerated"))
        elif key in cores:
            status.append((inst.definition, inst.kind, cores[key][0].parent, "ok (core found)"))
        elif inst.kind == "Rtl":
            folder = ws / place["Rtl"] / ent
            copier(tpl / "rtl-block", folder, {"name": inst.definition, "entity": ent, "vendor": vendor,
                                               "library": library, "logical_name": lib})
            (folder / "rtl" / f"{ent}.vhd").write_text("\n".join(skeleton(inst)))
            cores[key] = (folder / f"{ent}.core", yaml.safe_load((folder / f"{ent}.core").read_text().split("\n", 1)[1]))
            status.append((inst.definition, inst.kind, folder, "created (template + entity skeleton)"))
        else:
            status.append((inst.definition, inst.kind, None, f"MISSING: no core named {key}"))
            problems.append(f"{inst.definition}: no core named {key}")

    for d, k, f, s in status:
        print(f"{d:22} {k or '-':10} {str(f.relative_to(ws)) if f else '-':32} {s}")
    for p in problems:
        print(f"warning: {p}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
