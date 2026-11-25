"""FpgaOne regenerates byte-identical to the golden files, and compiles with GHDL."""
import shutil
import subprocess
from pathlib import Path

import pytest

from hdl_architect.generators import questa_compile, vhdl

ROOT = Path(__file__).resolve().parents[1]
GOLDEN = ROOT / "tests" / "golden" / "fpga_one"
PATHS = ["lib", "ip", "subsystems", "fpgas"]
OUTPUTS = {"serial_subsystem.vhd": "subsystems/serial/gen/serial_subsystem.vhd",
           "fpga_one.vhd": "fpgas/fpga_one/gen/fpga_one.vhd",
           "compile.do": "sim/compile.do"}


@pytest.fixture()
def design(tmp_path, monkeypatch):
    d = tmp_path / "fpga_one"
    shutil.copytree(ROOT / "examples" / "fpga_one", d, ignore=shutil.ignore_patterns("gen", "sim"))
    monkeypatch.chdir(d)
    args = sum((["--path", p] for p in PATHS), [])
    assert vhdl.main(args + ["--top", "FpgaOne"]) == 0
    (d / "sim").mkdir()
    assert questa_compile.main(args + ["--top", "FpgaOne", "--out", "sim/compile.do", "--check-files"]) == 0
    return d


def test_generated_files_match_golden(design):
    for golden, out in OUTPUTS.items():
        assert (design / out).read_text() == (GOLDEN / golden).read_text(), out


@pytest.mark.skipif(shutil.which("ghdl") is None, reason="GHDL not installed")
def test_ghdl_analyzes_in_compile_order(design):
    work = design / "sim" / "ghdl"
    for line in (design / "sim" / "compile.do").read_text().splitlines():
        if not line.startswith("vcom"):
            continue
        lib = line.split("-work ")[1].split()[0]
        src = line.split('"$ROOT/')[1].rstrip('"')
        (work / lib).mkdir(parents=True, exist_ok=True)
        libs = [f"-P{p}" for p in work.iterdir()]
        r = subprocess.run(["ghdl", "-a", "--std=08", f"--work={lib}", f"--workdir={work / lib}", *libs,
                            str(design / src)], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
