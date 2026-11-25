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
    changed = ops.connect(m, TOP, "adc_if.x", "ethernet.y").changed
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
    changed = ops.connect(m, TOP, "adc_if.x", "ethernet.y").changed
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
    assert ops.connect(m, "Top", "a.m", "b.s").changed == ["design"]  # Bus with ~Bus
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


# ---------------------------------------------------------------- set_interface
def port_of(m, d, ident):
    return next(u for u in m.part_def(d)[2]["ports"] if ops.ident(u) == ident)


def test_set_interface_on_one_and_several_ports(wifi):
    docs, m = load(wifi)
    add_port(m, "Uart", "p1")
    add_port(m, "Ethernet", "p2")
    r = ops.set_interface(m, [("Uart", "p1"), ("Ethernet", "p2")], "BitIn")
    assert (
        port_of(m, "Uart", "p1")["type"]
        == port_of(m, "Ethernet", "p2")["type"]
        == "BitIn"
    )
    assert r.changed == [str(wifi / "wifi_packet_router_subsystems.json")]
    assert r.notes == []


def test_set_interface_types_the_untyped_far_end_of_a_wire(wifi):
    docs, m = load(wifi)
    add_port(m, "AdcInterface", "x")
    add_port(m, "Ethernet", "y")
    add_port(m, TOP, "e")
    add_port(m, "Uart", "z")
    top(m).setdefault("connections", []).append({"ends": ["adc_if.x", "ethernet.y"]})
    top(m).setdefault("bindings", []).append({"ends": ["e", "uart.z"]})
    r = ops.set_interface(m, [("AdcInterface", "x")], "Axi4LiteManager", TOP)
    assert (
        port_of(m, "Ethernet", "y")["type"] == "Axi4LiteSubordinate"
    )  # the other role
    assert r.notes == ["Also typed the other end: ethernet.y : Axi4LiteSubordinate."]
    ops.set_interface(m, [("Uart", "z")], "BitIn", TOP)
    assert port_of(m, TOP, "e")["type"] == "BitIn"  # a bind: the same interface


def test_set_interface_leaves_a_typed_far_end_alone(wifi):
    docs, m = load(wifi)
    add_port(m, "AdcInterface", "x")
    add_port(m, "Ethernet", "y", "BitIn")
    top(m).setdefault("connections", []).append({"ends": ["adc_if.x", "ethernet.y"]})
    r = ops.set_interface(m, [("AdcInterface", "x")], "Axi4LiteManager", TOP)
    assert port_of(m, "Ethernet", "y")["type"] == "BitIn"
    assert r.notes == []


def test_set_interface_none_clears_it_and_conjugation(wifi):
    docs, m = load(wifi)
    p = add_port(m, "Uart", "p", "BitIn")
    p["conjugated"] = True
    ops.set_interface(m, [("Uart", "p")], None)
    assert "type" not in p and "conjugated" not in p


def test_set_interface_refusals_and_imports():
    lib = {
        "schemaVersion": "0.6",
        "package": {"name": "Lib", "portDefs": [{"name": "Bus"}]},
    }
    design = {
        "schemaVersion": "0.6",
        "package": {
            "name": "Design",
            "partDefs": [{"name": "A", "ports": [{"name": "p"}]}],
        },
    }
    m = ops.Model({"lib": lib, "design": design})
    with pytest.raises(ops.OpError) as e:
        ops.set_interface(m, [("A", "p")], "NoSuchDef")
    assert e.value.code == "not_found"
    with pytest.raises(ops.OpError) as e:
        ops.set_interface(m, [("A", "nope")], "Bus")
    assert e.value.code == "not_found"
    ops.set_interface(m, [("A", "p")], "Bus")
    assert {"name": "Lib::*"} in design["package"]["imports"]


def test_ha_set_interface(wifi, capsys):
    docs, m = load(wifi)
    add_port(m, "Uart", "p1")
    for f, doc in docs.items():
        write_model_file(f, doc)
    assert ha(["set-interface", "Uart.p1", "--type", "BitIn", "--path", str(wifi)]) == 0
    assert ha(["set-interface", "Uart.p1", "--type", "Nope", "--path", str(wifi)]) == 1
    assert "refused (not_found)" in capsys.readouterr().err
    _, m2 = load(wifi)
    assert port_of(m2, "Uart", "p1")["type"] == "BitIn"


# ---------------------------------------------------------------- ports
SUBS = "wifi_packet_router_subsystems.json"


def wires(m, d=TOP):
    s = m.part_def(d)[2]
    return [w["ends"] for w in s.get("connections", []) + s.get("bindings", [])]


def test_add_port_gives_a_unique_name_and_imports_its_type(wifi):
    docs, m = load(wifi)
    r = ops.add_port(m, "Uart", "irq", "BitIn")
    assert r.data == {"name": "irq"} and r.changed == [str(wifi / SUBS)]
    assert ops.add_port(m, "Uart", "irq").data == {"name": "irq_2"}
    assert port_of(m, "Uart", "irq")["type"] == "BitIn"
    with pytest.raises(ops.OpError) as e:
        ops.add_port(m, "Uart", "2bad")
    assert e.value.code == "bad_name"


def test_rename_port_updates_wires_and_clock_pairings(wifi):
    docs, m = load(wifi)
    r = ops.rename_port(m, "AdcInterface", "ref_clk", "jesd_clk")
    assert port_of(m, "AdcInterface", "jesd_clk")["type"] == "ClockIn"
    assert ["jesd_refclk", "adc_if.jesd_clk"] in wires(m)  # the wire on the top sheet
    assert port_of(m, "AdcInterface", "sysref")["redefines"]["clock_port"] == "jesd_clk"
    assert sorted(r.changed) == sorted([str(wifi / FPGA), str(wifi / SUBS)])


def test_rename_a_sheet_port_updates_its_own_sheet(wifi):
    docs, m = load(wifi)
    ops.rename_port(m, TOP, "sys_clock", "board_clock")
    assert ["board_clock", "adc_if.clk"] in wires(m)
    assert not any("sys_clock" in e for w in wires(m) for e in w)


def test_rename_port_keeps_the_readable_name(wifi):
    docs, m = load(wifi)
    p = add_port(m, "Uart", "x", "BitIn")
    p.update({"name": "Spare IRQ", "shortName": "x"})
    ops.rename_port(m, "Uart", "x", "irq_spare")
    assert (p["name"], p["shortName"]) == ("Spare IRQ", "irq_spare")


def test_rename_port_refusals(wifi):
    docs, m = load(wifi)
    for new, code in (("rst", "exists"), ("has space", "bad_name"), ("_x", "bad_name")):
        with pytest.raises(ops.OpError) as e:
            ops.rename_port(m, "AdcInterface", "ref_clk", new)
        assert e.value.code == code
    with pytest.raises(ops.OpError) as e:
        ops.rename_port(m, "AdcInterface", "nope", "x")
    assert e.value.code == "not_found"


def test_delete_port_removes_its_wires_and_pairings(wifi):
    docs, m = load(wifi)
    n = len(wires(m))
    r = ops.delete_port(m, "AdcInterface", "ref_clk")
    assert len(wires(m)) == n - 1
    assert not any("adc_if.ref_clk" in w for w in wires(m))
    assert "clock_port" not in (
        port_of(m, "AdcInterface", "sysref").get("redefines") or {}
    )
    assert r.notes == [
        "Removed 1 wire(s) to AdcInterface.ref_clk.",
        "sysref is no longer paired with a clock.",
    ]
    with pytest.raises(StopIteration):
        port_of(m, "AdcInterface", "ref_clk")


def test_ha_port_commands(wifi, capsys):
    path = ["--path", str(wifi)]
    assert ha(["add-port", "Uart.spare", "--type", "BitIn", *path]) == 0
    assert ha(["rename-port", "Uart.spare", "spare_irq", *path]) == 0
    assert ha(["rename-port", "Uart.nope", "x", *path]) == 1
    assert ha(["delete-port", "Uart.spare_irq", *path]) == 0
    assert "refused (not_found)" in capsys.readouterr().err
    _, m = load(wifi)
    assert not any(
        ops.ident(u).startswith("spare") for u in m.part_def("Uart")[2]["ports"]
    )
    assert ha(["serve", "--path", str(wifi), "--normalize"]) == 0
    assert "0 changed" in capsys.readouterr().out


# ---------------------------------------------------------------- new port + wire
def test_connect_new_two_new_ports_named_after_each_other(wifi):
    docs, m = load(wifi)
    r = ops.connect_new(
        m, TOP, {"new": "uart", "name": "temp_if"}, {"new": "temp_if", "name": "uart"}
    )
    assert r.data == {"a": "temp_if", "b": "uart"}
    assert top(m)["connections"][-1] == {"ends": ["uart.temp_if", "temp_if.uart"]}
    assert "type" not in port_of(
        m, "Uart", "temp_if"
    )  # both untyped: an interface later


def test_connect_new_port_takes_the_matching_role(wifi):
    docs, m = load(wifi)
    add_port(m, "AdcInterface", "x", "Axi4LiteManager")
    r = ops.connect_new(m, TOP, "adc_if.x", {"new": "ethernet", "name": "adc_if"})
    assert port_of(m, "Ethernet", r.data["b"])["type"] == "Axi4LiteSubordinate"
    assert top(m)["connections"][-1] == {
        "ends": ["adc_if.x", f"ethernet.{r.data['b']}"]
    }


def test_connect_new_sheet_port_binds_with_the_same_interface(wifi):
    docs, m = load(wifi)
    add_port(m, "Uart", "x", "BitIn")
    r = ops.connect_new(m, TOP, {"new": None, "name": "x"}, "uart.x")
    assert port_of(m, TOP, r.data["a"])["type"] == "BitIn"
    assert top(m)["bindings"][-1] == {"ends": [r.data["a"], "uart.x"]}


def test_connect_new_refused_writes_nothing(wifi):
    """A refused gesture leaves no half-made port behind on disk."""
    docs, m = load(wifi)
    store = Store([wifi])
    pkgs = {p["file"]: p for p in store.scan()}
    bases = {f: p["version"] for f, p in pkgs.items()}
    before = {f: Path(f).read_text() for f in docs}
    code, res = store.apply_op(
        {
            "op": "connect_new",
            "sheet": TOP,
            "a": "sys_clock",  # a clock: a net, not a wire
            "b": {"new": "uart", "name": "clk2"},
            "bases": bases,
        }
    )
    assert (code, res["error"]["code"]) == (422, "net")
    assert {f: Path(f).read_text() for f in docs} == before


# ---------------------------------------------------------------- parts and definitions
def still_checks(docs, d):
    """Write every file back; the whole model must still load and check."""
    from hdl_architect.core.model import check_model

    for f, doc in docs.items():
        write_model_file(f, doc)
    check_model([d])


def part_types(m, sheet=TOP):
    return {p["name"]: p["type"] for p in m.part_def(sheet)[2].get("parts", [])}


def test_add_part_of_a_new_kind_and_of_an_existing_def(wifi):
    docs, m = load(wifi)
    r = ops.add_part(m, TOP, "dma_ctrl", kind="Rtl")
    assert r.data == {"type": "DmaCtrl"} and part_types(m)["dma_ctrl"] == "DmaCtrl"
    assert m.part_def("DmaCtrl")[2]["specializes"] == ["Rtl"]
    assert ops.add_part(m, TOP, "dma2", kind="Rtl").data == {"type": "Dma2"}
    assert ops.add_part(m, TOP, "uart2", def_name="Uart").data == {"type": "Uart"}
    for args, code in (
        (("uart", "Rtl", None), "exists"),
        (("2x", "Rtl", None), "bad_name"),
        (("y", "NoKind", None), "not_found"),
        (("y", None, "NoDef"), "not_found"),
        (("y", None, None), "bad_request"),
    ):
        with pytest.raises(ops.OpError) as e:
            ops.add_part(m, TOP, args[0], kind=args[1], def_name=args[2])
        assert e.value.code == code, args
    still_checks(docs, wifi)


def test_rename_part_updates_its_wires(wifi):
    docs, m = load(wifi)
    ops.rename_part(m, TOP, "adc_if", "adc")
    assert "adc" in part_types(m) and "adc_if" not in part_types(m)
    assert ["adc_jesd", "adc.adc_jesd"] in wires(m)
    assert not any(e.startswith("adc_if.") for w in wires(m) for e in w)
    with pytest.raises(ops.OpError) as e:
        ops.rename_part(m, TOP, "adc", "uart")
    assert e.value.code == "exists"
    still_checks(docs, wifi)


def test_delete_part_removes_its_wires(wifi):
    docs, m = load(wifi)
    n = len(wires(m))
    r = ops.delete_part(m, TOP, "adc_if")
    assert "adc_if" not in part_types(m)
    assert len(wires(m)) == n - 8 and r.notes == ["Removed 8 wire(s) to adc_if."]
    still_checks(docs, wifi)


def test_rename_def_updates_every_reference(wifi):
    docs, m = load(wifi)
    r = ops.rename_def(m, "Uart", "UartStatus")
    assert part_types(m)["uart"] == "UartStatus"
    assert m.part_def("UartStatus")
    assert str(wifi / FPGA) in r.changed  # where the part is
    ops.rename_def(m, "Axi4LiteManager", "AxiLiteMgr")  # a port def, with a named role
    assert m.port_defs["Axi4LiteSubordinate"][2]["conjugateOf"] == "AxiLiteMgr"
    assert port_of(m, "Control", "uart")["type"] == "AxiLiteMgr"
    for new, code in (("Ethernet", "exists"), ("bad name", "bad_name")):
        with pytest.raises(ops.OpError) as e:
            ops.rename_def(m, "UartStatus", new)
        assert e.value.code == code
    still_checks(docs, wifi)


def test_set_part_def_removes_wires_to_ports_the_new_def_lacks(wifi):
    docs, m = load(wifi)
    r = ops.set_part_def(m, TOP, "uart", "TempSensorInterface")
    assert part_types(m)["uart"] == "TempSensorInterface"
    left = [e for w in wires(m) for e in w if e.startswith("uart.")]
    have = {ops.ident(u) for u in m.part_def("TempSensorInterface")[2]["ports"]}
    assert all(e.split(".")[1] in have for e in left)
    assert r.notes and r.notes[0].startswith("Removed ")
    still_checks(docs, wifi)


def test_set_kind_replaces_the_kind(wifi):
    docs, m = load(wifi)
    ops.set_kind(m, "Uart", "Subsystem")
    assert m.part_def("Uart")[2]["specializes"] == ["Subsystem"]
    with pytest.raises(ops.OpError) as e:
        ops.set_kind(m, "Uart", "Ethernet")  # a def, but not a kind
    assert e.value.code == "not_found"
    still_checks(docs, wifi)


def test_ha_part_commands(wifi, capsys):
    path = ["--path", str(wifi)]
    assert ha(["add-part", f"{TOP}.dbg", "--kind", "Rtl", *path]) == 0
    assert ha(["rename-part", f"{TOP}.dbg", "debug", *path]) == 0
    assert ha(["rename-def", "Dbg", "DebugCore", *path]) == 0
    assert ha(["set-kind", "DebugCore", "VendorIp", *path]) == 0
    assert ha(["delete-part", f"{TOP}.debug", *path]) == 0
    assert ha(["delete-part", f"{TOP}.nope", *path]) == 1
    _, m = load(wifi)
    assert "debug" not in part_types(m)
    assert m.part_def("DebugCore")[2]["specializes"] == ["VendorIp"]
    assert ha(["check", "--path", str(wifi)]) == 0


# ---------------------------------------------------------------- global nets
def test_assign_net_moves_a_sink_to_another_net(wifi):
    docs, m = load(wifi)
    assert ["CLK_RST_CTRL.rst_out", "uart.rst"] in wires(m)
    ops.assign_net(m, TOP, "uart.rst", "sys_reset_f")
    assert ["CLK_RST_CTRL.rst_out", "uart.rst"] not in wires(m)
    assert ["sys_reset_f", "uart.rst"] in wires(m)  # a bind: the source is a sheet port
    ops.assign_net(m, TOP, "uart.rst", None)  # on no net
    assert not any("uart.rst" in w for w in wires(m))
    still_checks(docs, wifi)


def test_assign_net_refusals(wifi):
    docs, m = load(wifi)
    for end, src, code in (
        ("uart.clk", "sys_reset_f", "wrong_kind"),  # a clock onto a reset net
        ("uart.rst", "uart.clk", "not_a_source"),  # a sink cannot drive a net
        ("uart.rst", "adc_jesd", "not_a_source"),  # not a global port at all
        ("CLK_RST_CTRL.rst_out", "sys_reset_f", "is_a_source"),
        ("uart.processing", "sys_clock", "not_global"),
    ):
        with pytest.raises(ops.OpError) as e:
            ops.assign_net(m, TOP, end, src)
        assert e.value.code == code, (end, src, e.value.message)


def test_assign_net_with_retype_makes_the_port_an_input_of_the_net(wifi):
    docs, m = load(wifi)
    add_port(m, "Uart", "x", "BitIn")
    ops.assign_net(m, TOP, "uart.x", "sys_clock", retype=True)
    assert port_of(m, "Uart", "x")["type"] == "ClockIn"
    assert ["sys_clock", "uart.x"] in wires(m)
    still_checks(docs, wifi)


def test_set_frequency(wifi):
    docs, m = load(wifi)
    ops.set_frequency(m, TOP, "sys_clock", 125e6)
    assert port_of(m, TOP, "sys_clock")["redefines"]["frequency_hz"] == 125e6
    for src, hz, code in (
        ("sys_clock", 0, "bad_value"),
        ("uart.clk", 1e6, "not_a_source"),
    ):
        with pytest.raises(ops.OpError) as e:
            ops.set_frequency(m, TOP, src, hz)
        assert e.value.code == code
    still_checks(docs, wifi)


def test_pair_clock_and_reset_synchronism(wifi):
    docs, m = load(wifi)
    ops.pair_clock(m, "AdcInterface", "rst", "clk")
    r = port_of(m, "AdcInterface", "rst")["redefines"]
    assert r["clock_port"] == "clk" and r["synchronous"] is True
    ops.pair_clock(m, "AdcInterface", "rst", None)
    r = port_of(m, "AdcInterface", "rst").get("redefines", {})
    assert "clock_port" not in r and r.get("synchronous") is False
    for port, clock, code in (
        ("clk", "ref_clk", "not_pairable"),  # a clock is not paired
        ("sysref", "rst", "not_a_clock"),
    ):
        with pytest.raises(ops.OpError) as e:
            ops.pair_clock(m, "AdcInterface", port, clock)
        assert e.value.code == code
    still_checks(docs, wifi)


def test_add_global_port(wifi):
    docs, m = load(wifi)
    r = ops.add_global_port(m, "Uart", "reset", "in", "rst")
    assert r.data == {"name": "rst_2"}
    assert port_of(m, "Uart", "rst_2")["type"] == "ResetIn"
    assert "asynchronous" in r.notes[0]
    r = ops.add_global_port(m, "Uart", "sysref", "in", "sysref")  # Uart has one clock
    assert port_of(m, "Uart", "sysref")["redefines"]["clock_port"] == "clk"
    r = ops.add_global_port(m, "AdcInterface", "sysref", "in", "sysref")  # two clocks
    assert "pair it with its device clock" in r.notes[0]
    still_checks(docs, wifi)


def test_add_global_port_uses_the_conjugate_when_only_one_direction_exists():
    lib = {
        "schemaVersion": "0.6",
        "package": {"name": "Lib", "portDefs": [{"name": "ClockIn"}]},
    }
    design = {
        "schemaVersion": "0.6",
        "package": {"name": "Design", "partDefs": [{"name": "Pll", "ports": []}]},
    }
    m = ops.Model({"lib": lib, "design": design})
    ops.add_global_port(m, "Pll", "clock", "out", "clk_out")
    u = design["package"]["partDefs"][0]["ports"][0]
    assert (u["type"], u.get("conjugated")) == ("ClockIn", True)  # ~ClockIn


# -------------------------------------------------- wires, descriptions, names
def test_delete_wire_either_order(wifi):
    docs, m = load(wifi)
    ops.delete_wire(m, TOP, "Control.adc_if", "adc_if.Control")
    assert ["adc_if.Control", "Control.adc_if"] not in wires(m)
    with pytest.raises(ops.OpError) as e:
        ops.delete_wire(m, TOP, "Control.adc_if", "adc_if.Control")
    assert e.value.code == "not_found"
    still_checks(docs, wifi)


def test_set_doc_on_a_def_and_a_port(wifi):
    docs, m = load(wifi)
    ops.set_doc(m, "Uart", None, "  Status out.\n   Over the UART.  ")
    assert m.part_def("Uart")[2]["doc"] == "Status out.\nOver the UART."
    ops.set_doc(m, "Uart", "clk", "The UART's clock.")
    assert port_of(m, "Uart", "clk")["doc"] == "The UART's clock."
    ops.set_doc(m, "Uart", "clk", "")
    assert "doc" not in port_of(m, "Uart", "clk")
    ops.set_doc(m, "BitIn", None, "One bit.")  # a port def too
    assert m.port_defs["BitIn"][2]["doc"] == "One bit."
    still_checks(docs, wifi)


def test_set_port_name_is_sysml_name_and_short_name(wifi):
    docs, m = load(wifi)
    ops.set_port_name(m, "Uart", "clk", "UART clock")
    p = port_of(m, "Uart", "clk")
    assert (p["name"], p["shortName"]) == ("UART clock", "clk")
    ops.set_port_name(m, "Uart", "clk", "")  # removed: the identifier is the name again
    p = port_of(m, "Uart", "clk")
    assert p["name"] == "clk" and "shortName" not in p
    with pytest.raises(ops.OpError) as e:
        ops.set_port_name(m, "Uart", "clk", "it's")
    assert e.value.code == "bad_name"
    still_checks(docs, wifi)


def test_ha_op_runs_any_operation_by_name(wifi, capsys):
    path = ["--path", str(wifi)]
    (wifi / "ha.toml").write_text(f'[model]\npaths = ["."]\ntop = "{TOP}"\n')
    assert (
        ha(["op", "pair_clock", "def=AdcInterface", "port=rst", "clock=clk", *path])
        == 0
    )
    assert (
        ha(
            [
                "op",
                "set_frequency",
                "source=sys_clock",
                "hz=125e6",
                "--config",
                str(wifi / "ha.toml"),
            ]
        )
        == 0
    )
    assert ha(["op", "pair_clock", "def=AdcInterface", *path]) == 1  # port missing
    assert ha(["op", "nope", *path]) == 1
    err = capsys.readouterr().err
    assert "missing port" in err and "refused (unknown_op)" in err
    _, m = load(wifi)
    assert port_of(m, "AdcInterface", "rst")["redefines"]["clock_port"] == "clk"
    assert port_of(m, TOP, "sys_clock")["redefines"]["frequency_hz"] == 125e6
    assert ha(["check", "--path", str(wifi)]) == 0


def test_every_operation_is_runnable_by_name():
    """The table front ends use: each entry names a function in this module."""
    assert {"connect", "set_interface", "assign_net", "set_doc"} <= set(ops.OPERATIONS)
    for name, (call, required, optional) in ops.OPERATIONS.items():
        assert callable(call) and required, name
        assert not set(required) & set(optional), name
