"""core.ops.connect: the model rules for wiring two existing ports, for every
front end (HA 2 through its server, `ha connect`)."""

import json
import shutil
from pathlib import Path

import pytest

from hdl_architect.cli import main as ha
from hdl_architect.core import ops
from hdl_architect.core.files import read_model_files, write_model_file
from hdl_architect.editor.server import Store

FIXTURE = Path(__file__).parent / "ha2" / "fixtures" / "wifi_router"
TOP = "WifiPacketRouterFpga"
FPGA = "wifi_packet_router_fpga.json"


@pytest.fixture()
def wifi(tmp_path):
    d = tmp_path / "wifi"
    shutil.copytree(FIXTURE, d)
    return d


def load(d):
    docs = read_model_files([d])
    return docs, ops.Model(docs)


def add_port(model, part_def, name, type_=None):
    port = {"name": name, **({"type": type_} if type_ else {})}
    model.part_def(part_def)[2].setdefault("ports", []).append(port)
    return port


def top(model):
    return model.part_def(TOP)[2]


def test_two_roles_of_one_interface_connect(wifi):
    docs, m = load(wifi)
    add_port(m, "AdcInterface", "x", "Axi4LiteManager")
    add_port(m, "Ethernet", "y", "Axi4LiteSubordinate")
    changed = ops.connect(m, TOP, "adc_if.x", "ethernet.y")
    assert changed == [str(wifi / FPGA)]
    assert top(m)["connections"][-1] == {"ends": ["adc_if.x", "ethernet.y"]}


def test_refusals(wifi):
    docs, m = load(wifi)
    add_port(m, "AdcInterface", "x", "Axi4LiteManager")
    add_port(m, "Ethernet", "y", "Axi4LiteManager")
    cases = [
        (("adc_if.Control", "Control.adc_if"), "exists"),  # already wired
        (("Control.adc_if", "adc_if.Control"), "exists"),  # either order
        (("adc_if.x", "ethernet.y"), "interfaces"),  # two managers
        (("sys_clock", "adc_jesd"), "two_sheet_ports"),
        (("adc_if.x", "adc_if.Control"), "same_component"),
        (("sys_clock", "CLK_RST_CTRL.sys_clk"), "net"),  # clocks are nets
        (("adc_if.nope", "ethernet.y"), "not_found"),
        (("nope.x", "ethernet.y"), "not_found"),
    ]
    for (a, b), code in cases:
        with pytest.raises(ops.OpError) as e:
            ops.connect(m, TOP, a, b)
        assert e.value.code == code, (a, b, e.value.message)
    with pytest.raises(
        ops.OpError, match="Axi4LiteManager goes with Axi4LiteSubordinate"
    ):
        ops.connect(m, TOP, "adc_if.x", "ethernet.y")


def test_an_untyped_end_takes_the_other_role(wifi):
    docs, m = load(wifi)
    add_port(m, "AdcInterface", "x", "Axi4LiteManager")
    y = add_port(m, "Ethernet", "y")
    changed = ops.connect(m, TOP, "adc_if.x", "ethernet.y")
    assert y["type"] == "Axi4LiteSubordinate"
    assert str(wifi / "wifi_packet_router_subsystems.json") in changed


def test_a_sheet_port_binds_to_the_same_interface(wifi):
    docs, m = load(wifi)
    add_port(m, TOP, "edge_s", "Axi4LiteSubordinate")
    add_port(m, "Ethernet", "s", "Axi4LiteSubordinate")
    add_port(m, "Ethernet", "mgr", "Axi4LiteManager")
    ops.connect(m, TOP, "ethernet.s", "edge_s")  # either order: the edge comes first
    assert top(m)["bindings"][-1] == {"ends": ["edge_s", "ethernet.s"]}
    with pytest.raises(ops.OpError, match="same interface"):
        ops.connect(m, TOP, "edge_s", "ethernet.mgr")


def test_ports_with_a_readable_name_are_found_by_their_short_name(wifi):
    docs, m = load(wifi)
    p = add_port(m, "AdcInterface", "x", "Axi4LiteManager")
    p.update({"name": "ADC config", "shortName": "x"})
    add_port(m, "Ethernet", "y", "Axi4LiteSubordinate")
    ops.connect(m, TOP, "adc_if.x", "ethernet.y")
    assert top(m)["connections"][-1] == {"ends": ["adc_if.x", "ethernet.y"]}


def test_conjugation_and_imports():
    """Layered-style ports (one def, one end conjugated); an untyped port's
    package gets the import for the interface it takes."""
    lib = {
        "schemaVersion": "0.6",
        "package": {"name": "Lib", "portDefs": [{"name": "Bus"}]},
    }
    design = {
        "schemaVersion": "0.6",
        "package": {
            "name": "Design",
            "partDefs": [
                {"name": "A", "ports": [{"name": "m", "type": "Bus"}]},
                {
                    "name": "B",
                    "ports": [
                        {"name": "s", "type": "Bus", "conjugated": True},
                        {"name": "u"},
                    ],
                },
                {
                    "name": "Top",
                    "parts": [{"name": "a", "type": "A"}, {"name": "b", "type": "B"}],
                },
            ],
        },
    }
    m = ops.Model({"lib": lib, "design": design})
    assert ops.connect(m, "Top", "a.m", "b.s") == ["design"]  # Bus with ~Bus
    with pytest.raises(ops.OpError, match="already wired"):
        ops.connect(m, "Top", "b.s", "a.m")
    ops.connect(m, "Top", "a.m", "b.u")  # untyped: takes the other end of Bus
    u = design["package"]["partDefs"][1]["ports"][1]
    assert (u["type"], u.get("conjugated")) == ("Bus", True)
    assert {"name": "Lib::*"} in design["package"]["imports"]


def test_ha_connect_writes_the_files_in_canonical_form(wifi, capsys):
    docs, m = load(wifi)
    add_port(m, "AdcInterface", "x", "Axi4LiteManager")
    add_port(m, "Ethernet", "y", "Axi4LiteSubordinate")
    for f, doc in docs.items():
        write_model_file(f, doc)
    (wifi / "ha.toml").write_text(f'[model]\npaths = ["."]\ntop = "{TOP}"\n')
    import os

    cwd = os.getcwd()
    os.chdir(wifi)
    try:
        assert ha(["connect", "adc_if.x", "ethernet.y"]) == 0
        assert ha(["connect", "adc_if.x", "ethernet.y"]) == 1  # now a duplicate
    finally:
        os.chdir(cwd)
    assert "refused (exists)" in capsys.readouterr().err
    saved = json.loads((wifi / FPGA).read_text())
    assert {"ends": ["adc_if.x", "ethernet.y"]} in next(
        d for d in saved["package"]["partDefs"] if d["name"] == TOP
    )["connections"]
    assert ha(["serve", "--path", str(wifi), "--normalize"]) == 0
    assert "0 changed" in capsys.readouterr().out  # written in canonical form


def test_the_server_runs_the_operation_and_guards_stale_files(wifi):
    docs, m = load(wifi)
    add_port(m, "AdcInterface", "x", "Axi4LiteManager")
    add_port(m, "Ethernet", "y", "Axi4LiteSubordinate")
    for f, doc in docs.items():
        write_model_file(f, doc)
    store = Store([wifi])
    pkgs = {p["file"]: p for p in store.scan()}
    bases = {f: p["version"] for f, p in pkgs.items()}
    op = {"op": "connect", "sheet": TOP, "a": "adc_if.x", "b": "ethernet.y"}
    before = (wifi / FPGA).read_text()
    code, res = store.apply_op({**op, "bases": {f: "old" for f in bases}})
    assert (code, res["error"]["code"]) == (409, "stale")
    assert (wifi / FPGA).read_text() == before  # nothing written
    code, res = store.apply_op({**op, "bases": bases})
    assert code == 200
    assert [c["file"] for c in res["changed"]] == [str((wifi / FPGA).resolve())]
    code, res = store.apply_op({**op, "bases": bases})
    assert (code, res["error"]["code"]) == (422, "exists")
