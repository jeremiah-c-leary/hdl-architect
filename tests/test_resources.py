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
        "lut": 960,
        "ff": 812,
        "bram36": 0,
        "uram": 0,
        "dsp48": 0,
    }
    assert report.over_capacity() == []
    assert report.not_estimated() == []
    assert report.problems == []


def test_a_block_with_parts_is_the_sum_of_its_parts():
    report = resource_report([WIFI], TOP)
    clock_reset = next(
        c for c in report.top.children if c.path.endswith("CLK_RST_CTRL")
    )
    assert clock_reset.used["lut"] == clock_reset.children[0].used["lut"] == 10


def test_a_block_without_an_estimate_is_listed_and_counts_zero(wifi_copy):
    change_def(wifi_copy, SUBSYSTEMS, "Uart", remove_estimate)
    report = resource_report([wifi_copy], TOP)
    assert report.not_estimated() == [f"{TOP}.uart"]
    assert report.top.used["lut"] == 960 - 250


def test_a_design_that_does_not_fit(wifi_copy, capsys):
    change_def(
        wifi_copy,
        SUBSYSTEMS,
        "Uart",
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


def add_estimate(definition: dict) -> None:
    definition.setdefault("attributes", []).append(
        {
            "name": "zynqUltraScalePlusEstimate",
            "type": "ZynqUltraScalePlusResources",
            "redefines": {"lut": 999},
        }
    )


def test_a_block_with_parts_may_not_have_an_estimate(wifi_copy, capsys):
    change_def(wifi_copy, FPGA, "CLKRSTCTRL", add_estimate)
    report = resource_report([wifi_copy], TOP)
    assert report.top.used["lut"] == 960
    assert len(report.problems) == 1
    assert "CLK_RST_CTRL (CLKRSTCTRL) may not have an estimate" in report.problems[0]
    assert ha(["report", "resources", "--path", str(wifi_copy), "--top", TOP]) == 1
    assert "error: " in capsys.readouterr().out


def test_a_subsystem_without_parts_may_not_have_an_estimate(wifi_copy):
    change_def(wifi_copy, SUBSYSTEMS, "Ethernet", add_estimate)
    report = resource_report([wifi_copy], TOP)
    assert report.top.used["lut"] == 960
    assert "ethernet (Ethernet) may not have an estimate" in report.problems[0]


def test_subsystems_without_parts_are_listed_to_break_down():
    report = resource_report([WIFI], TOP)
    assert report.to_break_down() == [
        f"{TOP}.{name}"
        for name in ["ethernet", "adc_if", "dac_if", "processing", "Control"]
    ]


def test_a_part_s_multiplicity_multiplies_its_estimate(wifi_copy):
    def three_reset_syncs(definition):
        definition["parts"][0]["multiplicity"] = 3

    change_def(wifi_copy, FPGA, "CLKRSTCTRL", three_reset_syncs)
    assert resource_report([wifi_copy], TOP).top.used["lut"] == 960 + 2 * 10


def test_the_report_prints_the_table_and_the_fit(capsys):
    assert ha(["report", "resources", "--path", str(WIFI), "--top", TOP]) == 0
    out = capsys.readouterr().out
    assert "Resources on XCZU9EG (ZynqUltraScalePlusResources)" in out
    assert "  uart : Uart" in out
    assert "to break down (no parts yet): " in out


def test_estimates_and_the_device_are_not_vhdl_generics():
    top = load_ir([WIFI], TOP)
    assert top.generics == {}
    assert all(child.generics == {} for child in top.children)


# ------------------------------------------------------- set_estimate (core.ops)

FAMILY = "ZynqUltraScalePlusResources"


def load_ops_model(model_dir: Path):
    from hdl_architect.core import ops
    from hdl_architect.core.files import read_model_files

    docs = read_model_files([model_dir])
    return docs, ops.Model(docs)


def write_and_check(docs, model_dir: Path) -> None:
    from hdl_architect.core.files import write_model_file
    from hdl_architect.core.model import check_model

    for file, doc in docs.items():
        write_model_file(file, doc)
    check_model([model_dir])


def estimate_on(model, def_name: str) -> dict | None:
    attributes = model.part_def(def_name)[2].get("attributes", [])
    return next((a for a in attributes if a["type"] == FAMILY), None)


def test_set_estimate_changes_a_leaf_s_counts_and_keeps_its_doc(wifi_copy):
    from hdl_architect.core import ops

    docs, model = load_ops_model(wifi_copy)
    ops.set_estimate(model, "Uart", FAMILY, {"lut": 500, "ff": 0, "dsp48": 2})
    estimate = estimate_on(model, "Uart")
    assert estimate["redefines"] == {"lut": 500, "dsp48": 2}  # zeros left out
    assert "illustrative" in estimate["doc"]
    write_and_check(docs, wifi_copy)
    assert resource_report([wifi_copy], TOP).top.used["lut"] == 960 - 250 + 500


def test_set_estimate_with_no_counts_removes_it(wifi_copy):
    from hdl_architect.core import ops

    docs, model = load_ops_model(wifi_copy)
    ops.set_estimate(model, "Uart", FAMILY, {"lut": 0})
    assert estimate_on(model, "Uart") is None
    write_and_check(docs, wifi_copy)
    assert resource_report([wifi_copy], TOP).not_estimated() == [f"{TOP}.uart"]


def test_a_new_estimate_adds_the_import_it_needs(wifi_copy):
    from hdl_architect.core import ops

    docs, model = load_ops_model(wifi_copy)
    ops.set_estimate(model, "Uart", FAMILY, {})
    package = model.part_def("Uart")[1]
    package["imports"] = [
        i for i in package["imports"] if i["name"] != "FpgaDevices::*"
    ]
    ops.set_estimate(model, "Uart", FAMILY, {"lut": 300})
    assert estimate_on(model, "Uart")["name"] == "zynqUltraScalePlusEstimate"
    assert {"name": "FpgaDevices::*"} in package["imports"]
    write_and_check(docs, wifi_copy)


@pytest.mark.parametrize("def_name", ["Ethernet", "CLKRSTCTRL"])
def test_set_estimate_refuses_roll_up_blocks(wifi_copy, def_name):
    from hdl_architect.core import ops

    _, model = load_ops_model(wifi_copy)
    with pytest.raises(ops.OpError) as refused:
        ops.set_estimate(model, def_name, FAMILY, {"lut": 1})
    assert refused.value.code == "roll_up"
    assert "Break it down" in refused.value.message


@pytest.mark.parametrize(
    "family, values, message",
    [
        ("NoSuchResources", {"lut": 1}, "no device family resources"),
        ("XCZU9EG", {"lut": 1}, "no device family resources"),
        (FAMILY, {"alm": 1}, "has no resource alm"),
        (FAMILY, {"lut": -1}, "whole number"),
        (FAMILY, {"lut": 1.5}, "whole number"),
        (FAMILY, {"lut": True}, "whole number"),
    ],
)
def test_set_estimate_refuses_bad_input(wifi_copy, family, values, message):
    from hdl_architect.core import ops

    _, model = load_ops_model(wifi_copy)
    with pytest.raises(ops.OpError, match=message):
        ops.set_estimate(model, "Uart", family, values)


def test_the_server_reports_each_definition_s_totals():
    from hdl_architect.editor.server import Store

    store = Store([WIFI])
    report = store.resources(TOP)
    assert report["device"] == "XCZU9EG"
    assert report["definitions"]["Uart"] == {
        "used": {"lut": 250, "ff": 200, "bram36": 0, "uram": 0, "dsp48": 0},
        "status": "estimated",
    }
    assert report["definitions"]["Ethernet"]["status"] == "to break down"
    assert report["definitions"][TOP]["used"]["lut"] == 960
    assert "no target device" in store.resources("Uart")["error"]


# ------------------------------------------------------------------ margins


def test_margins_are_the_family_s_defaults_and_the_design_s_own():
    target = resource_report([WIFI], TOP).target
    assert target.margins == {
        "lut": 30,
        "ff": 30,
        "bram36": 20,
        "uram": 30,
        "dsp48": 30,
    }
    assert target.budget("lut") == 274080 * 70 // 100
    assert target.budget("bram36") == 912 * 80 // 100


def test_a_design_past_its_margin_but_within_the_device(wifi_copy, capsys):
    change_def(
        wifi_copy,
        SUBSYSTEMS,
        "Uart",
        lambda d: estimate_of(d)["redefines"].update(lut=200000),
    )
    report = resource_report([wifi_copy], TOP)
    assert report.over_budget() == ["lut"]
    assert report.over_capacity() == []
    assert ha(["report", "resources", "--path", str(wifi_copy), "--top", TOP]) == 1
    assert "warning: lut: the design uses part of its margin" in (
        capsys.readouterr().out
    )


def test_without_margins_the_budget_is_the_whole_device(wifi_copy):
    def remove_margins(definition):
        definition["attributes"] = [
            a for a in definition["attributes"] if a["name"] != "resourceMargins"
        ]

    change_def(wifi_copy, FPGA, TOP, remove_margins)
    target = resource_report([wifi_copy], TOP).target
    assert target.margins["lut"] == 0
    assert target.budget("lut") == 274080


def test_the_server_sends_the_hierarchy_and_the_margins():
    from hdl_architect.editor.server import Store

    report = Store([WIFI]).resources(TOP)
    assert report["margins"]["bram36"] == 20
    assert report["budget"]["lut"] == 191856
    tree = report["tree"]
    assert tree["definition"] == TOP
    clock_reset = next(c for c in tree["children"] if c["name"] == "CLK_RST_CTRL")
    assert clock_reset["children"][0]["name"] == "RST_SYNC"
    assert f"{TOP}.ethernet" in report["toBreakDown"]
