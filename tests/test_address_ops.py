"""The address map's operations (core/address_ops.py): HA 2's Memory map
root…, Memory map windows… and Crossbar switch, on a copy of FpgaOne, read
back through the address report the view shows."""

import shutil
from pathlib import Path

import pytest

from hdl_architect.core import ops
from hdl_architect.core.addresses import address_report, report_as_dict
from hdl_architect.core.files import read_model_files, write_model_file
from hdl_architect.editor.server import Store

ROOT = Path(__file__).resolve().parents[1]
FPGA_ONE = ROOT / "examples" / "fpga_one"
LAYERS = ("lib", "ip", "subsystems", "fpgas")
TOP = "FpgaOne"
M0 = ["crossbar.m0", "csr.csr"]
M1 = ["crossbar.m1", "serial.csr"]


@pytest.fixture()
def fpga_one(tmp_path):
    for layer in LAYERS:
        shutil.copytree(FPGA_ONE / layer, tmp_path / layer)
    return tmp_path


def run(directory, name, args):
    """Run an operation on the files and write them, as the server does."""
    docs = read_model_files([directory / layer for layer in LAYERS])
    result = ops.run(ops.Model(docs), name, args)
    for file in result.changed:
        write_model_file(file, docs[file])
    return result


def report(directory):
    return address_report([str(directory / layer) for layer in LAYERS], TOP)


def blocks(block, found=None):
    found = {} if found is None else found
    found[block.path] = block
    for child in block.children:
        blocks(child, found)
    return found


# ---------------------------------------------------------------- roots


def test_set_root_renames_and_moves_the_map(fpga_one):
    run(fpga_one, "set_root", {"def": "ZynqPs", "port": "csr", "name": "cpu",
                               "base": 0x8000_0000})  # fmt: skip
    (memory_map,) = report(fpga_one).maps
    assert (memory_map.name, memory_map.base) == ("cpu", 0x8000_0000)
    assert (memory_map.port_def, memory_map.port) == ("ZynqPs", "csr")
    assert blocks(memory_map.top)["FpgaOne.serial.regs"].base == 0x8000_1000


def test_set_root_with_no_name_removes_it(fpga_one):
    run(fpga_one, "set_root", {"def": "ZynqPs", "port": "csr"})
    assert report(fpga_one).maps == []


def test_set_root_refusals(fpga_one):
    cases = [
        ({"def": "DeviceCsr", "port": "csr", "name": "x", "base": 0}, "not_manager"),
        ({"def": "ZynqPs", "port": "csr", "name": "2bad", "base": 0}, "bad_name"),
        ({"def": "ZynqPs", "port": "csr", "name": "ps", "base": -1}, "bad_value"),
        ({"def": "ZynqPs", "port": "nope", "name": "ps", "base": 0}, "not_found"),
    ]
    for args, code in cases:
        with pytest.raises(ops.OpError) as error:
            run(fpga_one, "set_root", args)
        assert error.value.code == code, (args, error.value.message)


# ---------------------------------------------------------------- windows


def test_set_windows_sets_several_at_once(fpga_one):
    windows = [
        {"ends": M0, "base": 0x1_0000, "size": 0x1_0000},
        {"ends": list(reversed(M1)), "base": 0, "size": 0x1000},  # either order
    ]
    result = run(fpga_one, "set_windows", {"sheet": TOP, "windows": windows})
    assert len(result.changed) == 1
    found = blocks(report(fpga_one).maps[0].top)
    assert (found["FpgaOne.csr"].base, found["FpgaOne.csr"].size) == (
        0x4001_0000,
        0x1_0000,
    )
    assert found["FpgaOne.serial.regs"].base == 0x4000_0000


def test_a_cleared_window_is_shown_as_not_set(fpga_one):
    windows = [{"ends": M1, "base": None}]
    run(fpga_one, "set_windows", {"sheet": TOP, "windows": windows})
    result = report(fpga_one)
    regs = blocks(result.maps[0].top)["FpgaOne.serial.regs"]
    assert not regs.window_set
    assert (regs.via.sheet, regs.via.port, regs.via.offset) == (TOP, "m1", None)
    assert result.problems == [
        "FpgaOne.crossbar.m1: no address window (every wired manager port of a "
        "crossbar needs one)"
    ]


def test_set_windows_refusals(fpga_one):
    cases = [
        ([{"ends": ["crossbar.m0", "serial.csr"], "base": 0, "size": 1}], "not_found"),
        ([{"ends": M0, "base": 0, "size": 0}], "bad_value"),
        ([{"ends": M0, "base": 0}], "bad_value"),  # no size
        ([{"ends": ["crossbar.m0"], "base": 0, "size": 1}], "bad_request"),
    ]
    for windows, code in cases:
        with pytest.raises(ops.OpError) as error:
            run(fpga_one, "set_windows", {"sheet": TOP, "windows": windows})
        assert error.value.code == code, (windows, error.value.message)


# ---------------------------------------------------------------- crossbars


def test_set_crossbar_keeps_the_kind_first(fpga_one):
    run(fpga_one, "set_crossbar", {"def": "AxiCrossbar1to2", "crossbar": False})
    result = report(fpga_one)
    assert any("is not a crossbar" in p for p in result.problems)
    run(fpga_one, "set_crossbar", {"def": "AxiCrossbar1to2", "crossbar": True})
    docs = ops.Model(read_model_files([fpga_one / layer for layer in LAYERS]))
    assert docs.part_def("AxiCrossbar1to2")[2]["specializes"] == [
        "VendorIp",
        "Crossbar",
    ]
    assert report(fpga_one).problems == []


# ---------------------------------------------------------------- the view's data


def test_the_report_as_ha2_sees_it(fpga_one):
    data = report_as_dict(report(fpga_one))
    (memory_map,) = data["maps"]
    assert (memory_map["portDef"], memory_map["port"]) == ("ZynqPs", "csr")
    crossbar = memory_map["top"]
    assert (crossbar["sheet"], crossbar["part"]) == (TOP, "crossbar")
    assert crossbar["managers"] == ["m0", "m1"]
    serial = crossbar["children"][1]
    assert serial["via"] == {"sheet": TOP, "ends": M1, "port": "m1",
                             "offset": 0x1000, "size": 0x1000}  # fmt: skip
    # the register file inside the subsystem: its own sheet, its own part
    assert (serial["sheet"], serial["part"]) == ("SerialSubsystem", "regs")


def test_the_server_answers_and_writes_valid_files(fpga_one):
    store = Store([fpga_one / layer for layer in LAYERS])
    bases = {p["file"]: p["version"] for p in store.scan()}
    code, response = store.apply_op({"op": "set_windows", "sheet": TOP,
                                     "windows": [{"ends": M0, "base": 0x2000,
                                                  "size": 0x1000}],
                                     "bases": bases})  # fmt: skip
    assert code == 200, response
    data = store.addresses(TOP)
    assert data["maps"][0]["top"]["children"][0]["base"] == 0x4000_2000
    assert "error" in store.addresses("Nope")
