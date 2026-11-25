"""`ha.toml`: the settings of the `ha` commands for one project (like pyproject.toml).

    [model]
    paths = ["."]                    # model search path
    top = "WifiPacketRouterFpga"     # top-level part def

    [scaffold]
    workspace = "ws"                 # where the workspace is created / updated
    templates = "../../templates"    # the team's Copier templates
    project = "wifi"                 # project name (first scaffold only)

Paths are relative to the file. Commands find the file with --config, or
look for ha.toml in the current directory and its parents. Command-line
options override the file. Unknown sections or keys are errors (a typo must
not be silently ignored).
"""
from __future__ import annotations

import tomllib
from pathlib import Path

from hdl_architect.core.model import ModelError

NAME = "ha.toml"
# section -> key -> (type, is a path or list of paths)
KEYS = {
    "model": {"paths": (list, True), "top": (str, False)},
    "scaffold": {"workspace": (str, True), "templates": (str, True), "project": (str, False)},
}


def find(start: Path | None = None) -> Path | None:
    """ha.toml in `start` (default: the current directory) or the nearest parent."""
    d = (start or Path.cwd()).resolve()
    for p in (d, *d.parents):
        if (p / NAME).is_file():
            return p / NAME
    return None


def load(path: Path | str | None = None) -> tuple[dict, Path | None]:
    """The settings, with paths made absolute; ({}, None) when there is no file."""
    f = Path(path) if path else find()
    if f is None:
        return {}, None
    if not f.is_file():
        raise ModelError(f"{f}: no such config file")
    try:
        raw = tomllib.loads(f.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as e:
        raise ModelError(f"{f}: {e}") from None
    base, out, problems = f.resolve().parent, {}, []
    for section, values in raw.items():
        if section not in KEYS or not isinstance(values, dict):
            problems.append(f"unknown section [{section}] (known: {', '.join(KEYS)})")
            continue
        out[section] = {}
        for key, v in values.items():
            if key not in KEYS[section]:
                problems.append(f"[{section}] unknown key '{key}' (known: {', '.join(KEYS[section])})")
                continue
            typ, is_path = KEYS[section][key]
            if not isinstance(v, typ) or (typ is list and not all(isinstance(x, str) for x in v)):
                problems.append(f"[{section}] {key} must be {'a list of strings' if typ is list else 'a string'}")
                continue
            if is_path:
                v = [str(base / x) for x in v] if typ is list else str(base / v)
            out[section][key] = v
    if problems:
        raise ModelError(f"{f}:\n  " + "\n  ".join(problems))
    return out, f
