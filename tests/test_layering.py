"""The package's dependency rules (CLAUDE.md, "Layers"), checked from the imports.

core       imports nothing else of ours
generators import core only, never each other or the editor
editor     imports core only
flow       may import core and generators (it orchestrates them)
"""

import ast
from pathlib import Path

PKG = Path(__file__).resolve().parents[1] / "src" / "hdl_architect"
ALLOWED = {
    "core": {"core"},
    "generators": {"core"},
    "editor": {"core"},
    "flow": {"core", "generators"},
}


def _ours(path: Path) -> set[str]:
    """hdl_architect.<layer>[.<module>] names this file imports."""
    out = set()
    for node in ast.walk(ast.parse(path.read_text())):
        names = (
            [a.name for a in node.names]
            if isinstance(node, ast.Import)
            else (
                [node.module]
                if isinstance(node, ast.ImportFrom) and node.module
                else []
            )
        )
        out |= {n for n in names if n.startswith("hdl_architect.")}
    return out


def test_layers():
    bad = []
    for layer, allowed in ALLOWED.items():
        for f in (PKG / layer).rglob("*.py"):
            for name in _ours(f):
                parts = name.split(".")
                target = parts[1]
                if target not in allowed and target != layer:
                    bad.append(f"{f.relative_to(PKG)} imports {name}")
                if layer == "generators" and target == "generators":
                    bad.append(
                        f"{f.relative_to(PKG)} imports another generator: {name}"
                    )
    assert not bad, "\n".join(bad)
