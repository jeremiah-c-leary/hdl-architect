"""Resource estimates: the roll-up, the fit against the target device, and
`ha report resources` (on the Wi-Fi example, and on changed copies of it)."""

import json
import shutil
from pathlib import Path

import pytest

from hdl_architect.cli import main as ha
from hdl_architect.core.model import ModelError, load_ir
from hdl_architect.core.resources import resource_report

WIFI = Path(__file__).resolve().parents[1] / "examples" / "wifi_router"
TOP = "WifiPacketRouterFpga"
SUBSYSTEMS = "wifi_packet_router_subsystems.json"
FPGA = "wifi_packet_router_fpga.json"


@pytest.fixture
def wifi_copy(tmp_path):
    shutil.copytree(WIFI, tmp_path / "wifi")
    return tmp_path / "wifi"


def change_def(model_dir: Path, file: str, name: str, change) -> None:
    """Apply `change(part_def)` to one part def of a copied model file."""
    path = model_dir / file
    doc = json.loads(path.read_text())
    definition = next(d for d in doc["package"]["partDefs"] if d["name"] == name)
    change(definition)
    path.write_text(json.dumps(doc, indent=2))


def estimate_of(definition: dict) -> dict:
    return next(a for a in definition["attributes"] if "Estimate" in a["name"])


def remove_estimate(definition: dict) -> None:
    definition["attributes"].remove(estimate_of(definition))


def test_the_wifi_design_rolls_up_and_fits():
    report = resource_report([WIFI], TOP)
    assert report.target.device == "XCZU9EG"
    assert report.target.capacity["lut"] == 274080
    assert report.top.used == {
        "lut": 85960,
        "ff": 124312,
        "bram36": 240,
        "uram": 0,
        "dsp48": 600,
    }
    assert report.over_capacity() == []
    assert report.not_estimated() == []


def test_a_container_is_the_sum_of_its_parts():
    report = resource_report([WIFI], TOP)
    clock_reset = next(
        c for c in report.top.children if c.path.endswith("CLK_RST_CTRL")
    )
    assert clock_reset.used["lut"] == clock_reset.children[0].used["lut"] == 10


def test_a_block_without_an_estimate_is_listed_and_counts_zero(wifi_copy):
    change_def(wifi_copy, SUBSYSTEMS, "Uart", remove_estimate)
    report = resource_report([wifi_copy], TOP)
    assert report.not_estimated() == [f"{TOP}.uart"]
    assert report.top.used["lut"] == 85960 - 250


def test_a_design_that_does_not_fit(wifi_copy, capsys):
    change_def(
        wifi_copy,
        SUBSYSTEMS,
        "Processing",
        lambda d: estimate_of(d)["redefines"].update(lut=300000),
    )
    assert resource_report([wifi_copy], TOP).over_capacity() == ["lut"]
    exit_code = ha(["report", "resources", "--path", str(wifi_copy), "--top", TOP])
    assert exit_code == 1
    assert "warning: lut: the design needs more than the device has" in (
        capsys.readouterr().out
    )


def test_an_fpga_without_a_target_device(wifi_copy, capsys):
    def remove_device(definition):
        definition["attributes"] = [
            a for a in definition["attributes"] if a["name"] != "device"
        ]

    change_def(wifi_copy, FPGA, TOP, remove_device)
    with pytest.raises(ModelError, match="no target device"):
        resource_report([wifi_copy], TOP)
    assert ha(["report", "resources", "--path", str(wifi_copy), "--top", TOP]) == 1
    assert "no target device" in capsys.readouterr().err


def test_a_container_s_own_estimate_is_not_used_and_says_so(wifi_copy):
    rst_sync_estimate = {
        "name": "zynqUltraScalePlusEstimate",
        "type": "ZynqUltraScalePlusResources",
        "redefines": {"lut": 999},
    }
    change_def(
        wifi_copy,
        FPGA,
        "CLKRSTCTRL",
        lambda d: d.setdefault("attributes", []).append(rst_sync_estimate),
    )
    report = resource_report([wifi_copy], TOP)
    assert report.top.used["lut"] == 85960
    assert any("CLK_RST_CTRL: its own estimate is not used" in n for n in report.notes)


def test_a_part_s_multiplicity_multiplies_its_estimate(wifi_copy):
    def three_reset_syncs(definition):
        definition["parts"][0]["multiplicity"] = 3

    change_def(wifi_copy, FPGA, "CLKRSTCTRL", three_reset_syncs)
    assert resource_report([wifi_copy], TOP).top.used["lut"] == 85960 + 2 * 10


def test_the_report_prints_the_table_and_the_fit(capsys):
    assert ha(["report", "resources", "--path", str(WIFI), "--top", TOP]) == 0
    out = capsys.readouterr().out
    assert "Resources on XCZU9EG (ZynqUltraScalePlusResources)" in out
    assert "  uart : Uart" in out
    assert "31%" in out


def test_estimates_and_the_device_are_not_vhdl_generics():
    top = load_ir([WIFI], TOP)
    assert top.generics == {}
    assert all(child.generics == {} for child in top.children)
