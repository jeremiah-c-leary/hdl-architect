"""Memory maps (core/addresses.py, decision 14): from each root, through
crossbars and subsystems, to every block's absolute address; and the checks."""

import json
import shutil
from pathlib import Path

import pytest

from hdl_architect.core.addresses import (
    CROSSBAR,
    REGISTERS,
    address_report,
    address_text,
    size_text,
)
from hdl_architect.reports import addresses as report_command

ROOT = Path(__file__).resolve().parents[1]
FPGA_ONE = ROOT / "examples" / "fpga_one"
FPGA_ONE_PATHS = [str(FPGA_ONE / p) for p in ("lib", "ip", "subsystems", "fpgas")]


def spans(block, found=None):
    """{path: (base, size, role)} for a block and everything under it."""
    found = {} if found is None else found
    found[block.path] = (block.base, block.size, block.role)
    for child in block.children:
        spans(child, found)
    return found


# ---------------------------------------------------------------- FpgaOne


def test_fpga_one_has_one_map_from_the_ps():
    report = address_report(FPGA_ONE_PATHS, "FpgaOne")
    assert report.problems == [] and report.warnings == []
    (memory_map,) = report.maps
    assert (memory_map.name, memory_map.root) == ("ps", "FpgaOne.ps.csr")
    assert spans(memory_map.top) == {
        "FpgaOne.crossbar": (0x4000_0000, None, CROSSBAR),
        "FpgaOne.csr": (0x4000_0000, 0x1000, REGISTERS),
        # through the subsystem's port, to the register file bound to it
        "FpgaOne.serial.regs": (0x4000_1000, 0x1000, REGISTERS),
    }


def test_the_report_command(capsys):
    args = sum((["--path", p] for p in FPGA_ONE_PATHS), []) + ["--top", "FpgaOne"]
    assert report_command.main(args) == 0
    out = capsys.readouterr().out
    assert "Memory map ps: from FpgaOne.ps.csr, at 0x4000_0000" in out
    assert "0x4000_1000..0x4000_1FFF  4 KiB  FpgaOne.serial.regs (SerialCsr)" in out


def test_address_and_size_text():
    assert address_text(0x1000) == "0x0000_1000"
    assert address_text(0x4_0000_0000) == "0x4_0000_0000"
    assert size_text(4096) == "4 KiB"
    assert size_text(1 << 20) == "1 MiB"
    assert size_text(100) == "100 B"


# ---------------------------------------------------------------- a design


def window(base, size):
    return [
        {
            "name": "window",
            "type": "AddressWindow",
            "redefines": {"base": base, "size": size},
        }
    ]


def root(name, base):
    return [
        {
            "name": "root",
            "type": "MemoryMapRoot",
            "redefines": {"map_name": name, "base": base},
        }
    ]


def port(name, conjugated=False, attributes=None):
    made = {"name": name, "type": "AxiLite"}
    if conjugated:
        made["conjugated"] = True
    if attributes:
        made["attributes"] = attributes
    return made


def connect(a, b, attributes=None):
    made = {"ends": [a, b]}
    if attributes:
        made["attributes"] = attributes
    return made


def design():
    """Two roots. The CPU reaches a crossbar; its windows reach a subsystem
    (with its own crossbar and two register files) and a DMA engine (not a
    crossbar, so a leaf, though it has a manager port of its own). The PCIe
    bridge reaches a register file straight, with no window."""
    defs = [
        {"name": "Cpu", "specializes": ["HardMacro"],
         "ports": [port("m", attributes=root("cpu", 0x8000_0000))]},
        {"name": "Pcie", "specializes": ["VendorIp"],
         "ports": [port("m", attributes=root("pcie", 0))]},
        {"name": "Xbar", "specializes": ["VendorIp", "Crossbar"],
         "ports": [port("s0", conjugated=True), port("m0"), port("m1")]},
        {"name": "Regs", "specializes": ["RegisterFile"],
         "ports": [port("csr", conjugated=True)]},
        {"name": "Dma", "specializes": ["Rtl"],
         "ports": [port("csr", conjugated=True), port("mem")]},
        {"name": "Sub", "specializes": ["Subsystem"],
         "ports": [port("csr", conjugated=True)],
         "parts": [{"name": "xbar", "type": "Xbar"},
                   {"name": "a", "type": "Regs"},
                   {"name": "b", "type": "Regs"}],
         "bindings": [{"ends": ["csr", "xbar.s0"]}],
         "connections": [connect("xbar.m0", "a.csr", window(0, 0x100)),
                         connect("xbar.m1", "b.csr", window(0x100, 0x100))]},
        {"name": "Top", "specializes": ["Fpga"],
         "parts": [{"name": n, "type": t} for n, t in (
             ("cpu", "Cpu"), ("xbar", "Xbar"), ("sub", "Sub"), ("dma", "Dma"),
             ("mem", "Regs"), ("pcie", "Pcie"), ("bar", "Regs"))],
         "connections": [connect("cpu.m", "xbar.s0"),
                         connect("xbar.m0", "sub.csr", window(0x1000, 0x1000)),
                         connect("xbar.m1", "dma.csr", window(0x2000, 0x1000)),
                         connect("dma.mem", "mem.csr"),
                         connect("pcie.m", "bar.csr")]},
    ]  # fmt: skip
    return {d["name"]: d for d in defs}


@pytest.fixture()
def model_dir(tmp_path):
    shutil.copy(FPGA_ONE / "lib" / "FpgaLib.json", tmp_path)
    return tmp_path


def report_of(model_dir, defs):
    package = {
        "name": "TestDesign",
        "imports": [{"name": "FpgaLib::*"}],
        "partDefs": list(defs.values()),
    }
    text = json.dumps({"schemaVersion": "0.10", "package": package})
    (model_dir / "design.json").write_text(text)
    return address_report([str(model_dir)], "Top")


def test_two_roots_nested_crossbars_and_a_leaf_with_its_own_manager(model_dir):
    report = report_of(model_dir, design())
    assert report.problems == [] and report.warnings == []
    cpu, pcie = report.maps
    assert (cpu.name, cpu.root, cpu.base) == ("cpu", "Top.cpu.m", 0x8000_0000)
    assert spans(cpu.top) == {
        "Top.xbar": (0x8000_0000, None, CROSSBAR),
        "Top.sub.xbar": (0x8000_1000, 0x1000, CROSSBAR),
        "Top.sub.a": (0x8000_1000, 0x100, REGISTERS),
        "Top.sub.b": (0x8000_1100, 0x100, REGISTERS),
        "Top.dma": (0x8000_2000, 0x1000, REGISTERS),
    }
    assert spans(pcie.top) == {"Top.bar": (0, None, REGISTERS)}


def sub_window(defs, end, base, size):
    for connection in defs["Sub"]["connections"]:
        if connection["ends"][0] == end:
            connection["attributes"] = window(base, size)


def test_overlapping_windows(model_dir):
    defs = design()
    sub_window(defs, "xbar.m1", 0x80, 0x100)
    (problem,) = report_of(model_dir, defs).problems
    assert "Top.sub.xbar: the windows of Top.sub.a and Top.sub.b overlap" in problem


def test_a_window_outside_its_crossbars_own(model_dir):
    defs = design()
    sub_window(defs, "xbar.m1", 0x800, 0x1000)
    (problem,) = report_of(model_dir, defs).problems
    assert problem.startswith("Top.sub.b: its window")
    assert "ends outside Top.sub.xbar's own" in problem


def test_a_window_not_aligned_to_its_size_is_a_warning(model_dir):
    defs = design()
    sub_window(defs, "xbar.m1", 0x180, 0x100)
    report = report_of(model_dir, defs)
    assert report.problems == []
    (warning,) = report.warnings
    assert "Top.sub.b: its window's base (0x8000_1180)" in warning


def test_a_crossbar_port_with_no_window(model_dir):
    defs = design()
    del defs["Sub"]["connections"][1]["attributes"]
    (problem,) = report_of(model_dir, defs).problems
    assert problem.startswith("Top.sub.xbar.m1: no address window")


def test_a_crossbar_whose_windows_are_not_set_yet(model_dir):
    """A crossbar says it is one: with no windows it is still not a leaf."""
    defs = design()
    for connection in defs["Sub"]["connections"]:
        del connection["attributes"]
    report = report_of(model_dir, defs)
    assert [p.split(":")[0] for p in report.problems] == [
        "Top.sub.xbar.m0",
        "Top.sub.xbar.m1",
    ]
    assert spans(report.maps[0].top)["Top.sub.xbar"][2] == CROSSBAR


def test_a_window_from_a_part_that_is_not_a_crossbar(model_dir):
    defs = design()
    defs["Top"]["connections"][3]["attributes"] = window(0, 0x1000)  # dma.mem
    (problem,) = report_of(model_dir, defs).problems
    assert problem == (
        "Top.dma.mem: has an address window, but Dma is not a crossbar "
        "(a part def :> Crossbar)"
    )


def test_a_root_must_be_a_manager_port(model_dir):
    defs = design()
    defs["Regs"]["ports"][0]["attributes"] = root("wrong", 0)
    problems = report_of(model_dir, defs).problems
    assert any("a memory map root must be the manager port" in p for p in problems)


def test_two_maps_with_one_name(model_dir):
    defs = design()
    defs["Pcie"]["ports"][0]["attributes"] = root("cpu", 0)
    assert "two memory maps are named cpu" in report_of(model_dir, defs).problems


def test_a_root_that_goes_nowhere(model_dir):
    defs = design()
    defs["Top"]["connections"].pop()  # pcie.m to bar.csr
    problems = report_of(model_dir, defs).problems
    assert problems == ["memory map pcie: Top.pcie.m goes nowhere"]


def test_no_roots(model_dir, capsys):
    defs = design()
    for name in ("Cpu", "Pcie"):
        del defs[name]["ports"][0]["attributes"]
    report = report_of(model_dir, defs)
    assert report.maps == [] and report.problems == []
    lines = report_command.report_lines(report, "Top")
    assert lines[0].startswith("Top has no memory map")
