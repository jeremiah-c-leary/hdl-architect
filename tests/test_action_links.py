"""The actions table (core.action_links): each action takes items in by a
port of its part and gives items out by a port, and which action feeds which
is worked out from the wires. The data is the user's own seven rows for
ReadTemperature (2026-11-26), entered on a scratch copy of the frozen Wi-Fi
fixture, through ops.run as every front end calls it."""

import copy
import shutil
from pathlib import Path

import pytest

from hdl_architect.core import ops
from hdl_architect.core.actions import action_report
from hdl_architect.core.files import read_model_files, write_model_file

WIFI = Path(__file__).resolve().parent / "ha2" / "fixtures" / "wifi_router_estimates"
TOP = "WifiPacketRouterFpga"
PERFORM = "readTemperature"

# The user's rows: part, action, ingress (port, item, item def), egress.
# Control's ports are named by their identifiers: "ethernet" is ETH CSR,
# "temp_if" is TEMP_CSR.
ROWS = [
    ("ethernet", "receiveFrame", ("eth_rgmii", "ethPacket", "EthPacket"),
     ("Interrupt", "int", "Int")),
    ("Control", "readFrame", ("eth_int", "int", "Int"),
     ("ethernet", "axi4liteRead", "Axi4LiteRead")),
    ("ethernet", "rxFrameReq", ("cmd", "axi4liteRead", "Axi4LiteRead"),
     ("cmd", "ethPacket", "EthPacket")),
    ("Control", "requestTemp", ("ethernet", "ethPacket", "EthPacket"),
     ("temp_if", "axi4liteRead", "Axi4LiteRead")),
    ("temp_if", "returnTemp", ("temp_read", "axi4liteRead", "Axi4LiteRead"),
     ("temp_read", "tempReading", "TempReading")),
    ("Control", "forwardTemp", ("temp_if", "tempReading", "TempReading"),
     ("ethernet", "tempEthPacket", "TempEthPacket")),
    ("ethernet", "transmitFrame", ("cmd", "tempEthPacket", "TempEthPacket"),
     ("eth_rgmii", "tempEthPacket", "TempEthPacket")),
]  # fmt: skip


@pytest.fixture
def wifi(tmp_path):
    folder = tmp_path / "wifi"
    shutil.copytree(WIFI, folder)
    return folder


class Session:
    """The model files of one scratch copy, edited by operations."""

    def __init__(self, folder: Path):
        self.folder = folder
        self.docs = read_model_files([folder])
        self.model = ops.Model(self.docs)

    def run(self, operation: str, /, **args) -> ops.Result:
        return ops.run(self.model, operation, args)

    def refused(self, operation: str, /, **args) -> str:
        with pytest.raises(ops.OpError) as refusal:
            self.run(operation, **args)
        return refusal.value.code

    def action_def(self, name: str) -> dict:
        return self.model.action_defs[name][2]

    def part_def(self, name: str) -> dict:
        return self.model.part_def(name)[2]

    def report(self):
        """Write the files and walk the actions the FPGA performs (which also
        validates every file against the schema)."""
        for file, doc in self.docs.items():
            write_model_file(Path(file), doc)
        return action_report([self.folder], TOP)

    def end(self, step: str, direction: str, **line) -> ops.Result:
        args = {"sheet": TOP, "perform": PERFORM, "step": step}
        return self.run("set_action_end", **args, direction=direction, **line)


def start_over(session: Session) -> None:
    """ReadTemperature without today's five actions, ReceiveFrame (which
    row 1 uses again) without its old items, and the interrupt wire the user
    found it needed."""
    for step in [s["name"] for s in session.action_def("ReadTemperature")["actions"]]:
        session.run("delete_step", sheet=TOP, perform=PERFORM, step=step)
    for item in ("ethFrame", "cmd"):
        session.run("delete_action_item", action="ReceiveFrame", item=item)
    session.run(
        "add_port", **{"def": "Ethernet", "name": "Interrupt", "type": "BitOut"}
    )
    session.run("add_port", **{"def": "Control", "name": "eth_int", "type": "BitIn"})
    session.run("connect", sheet=TOP, a="ethernet.Interrupt", b="Control.eth_int")


def enter_rows(session: Session) -> None:
    for part, step, _, _ in ROWS:
        action = step[0].upper() + step[1:]
        session.run(
            "add_step", sheet=TOP, perform=PERFORM, name=step, part=part, action=action
        )
    for _, step, ingress, egress in ROWS:
        session.end(step, "in", **line_args(session, step, ingress))
        session.end(step, "out", **line_args(session, step, egress))


def line_args(session: Session, step: str, line: tuple) -> dict:
    """A line on a port: its item, new on the port unless the port has it."""
    port, item, item_def = line
    part = performer_of(session, step)
    usage = next(u for u in session.part_def(part)["ports"] if ops.ident(u) == port)
    if any(i["name"] == item for i in usage.get("items", [])):
        return {"port": port, "portItem": item}
    return {"port": port, "newPortItem": {"name": item, "type": item_def}}


def performer_of(session: Session, step: str) -> str:
    sheet = session.part_def(TOP)
    part = next(
        a["to"] for a in sheet["allocations"] if a["from"] == f"{PERFORM}.{step}"
    )
    return ops.short(next(p["type"] for p in sheet["parts"] if p["name"] == part))


@pytest.fixture
def seven_rows(wifi):
    session = Session(wifi)
    start_over(session)
    enter_rows(session)
    return session


# ---------------------------------------------------------------- the user's rows


def test_each_line_gives_the_action_def_its_item_and_the_port_its_item(seven_rows):
    rx_frame_req = seven_rows.action_def("RxFrameReq")
    assert rx_frame_req["parameters"] == [
        {"name": "axi4liteRead", "direction": "in", "type": "Axi4LiteRead"},
        {"name": "ethPacket", "direction": "out", "type": "EthPacket"},
    ]
    ethernet = seven_rows.part_def("Ethernet")
    cmd = next(u for u in ethernet["ports"] if u["name"] == "cmd")
    assert {"name": "axi4liteRead", "direction": "in", "type": "Axi4LiteRead"} in cmd[
        "items"
    ]
    assert {"from": "cmd.axi4liteRead", "to": "rxFrameReq.axi4liteRead"} in ethernet[
        "flows"
    ]
    assert {"from": "rxFrameReq.ethPacket", "to": "cmd.ethPacket"} in ethernet["flows"]


def test_the_links_are_worked_out_from_the_wires(seven_rows):
    read_temperature = seven_rows.action_def("ReadTemperature")
    assert read_temperature["flows"] == [
        succession("receiveFrame.int", "readFrame.int"),
        succession("readFrame.axi4liteRead", "rxFrameReq.axi4liteRead"),
        succession("rxFrameReq.ethPacket", "requestTemp.ethPacket"),
        succession("requestTemp.axi4liteRead", "returnTemp.axi4liteRead"),
        succession("returnTemp.tempReading", "forwardTemp.tempReading"),
        succession("forwardTemp.tempEthPacket", "transmitFrame.tempEthPacket"),
    ]


def succession(source: str, target: str) -> dict:
    """`succession flow from source to target;`"""
    return {"from": source, "to": target, "succession": True}


def test_the_first_and_last_rows_are_fed_by_and_give_to_the_sheet(seven_rows):
    read_temperature = seven_rows.action_def("ReadTemperature")
    own = {p["name"]: p for p in read_temperature["parameters"]}
    assert own["ethPacket"] == {
        "name": "ethPacket",
        "direction": "in",
        "type": "EthPacket",
    }
    assert own["tempEthPacket"] == {
        "name": "tempEthPacket",
        "direction": "out",
        "type": "TempEthPacket",
    }
    assert {"ends": ["receiveFrame.ethPacket", "ethPacket"]} in read_temperature[
        "bindings"
    ]
    # Row 7 gets and gives tempEthPacket: one action def cannot have two
    # items of one name, so the one it gives is tempEthPacket_2.
    assert {"ends": ["transmitFrame.tempEthPacket_2", "tempEthPacket"]} in (
        read_temperature["bindings"]
    )
    sheet_flows = seven_rows.part_def(TOP)["flows"]
    assert {"from": "eth_rgmii.ethPacket", "to": "readTemperature.ethPacket"} in (
        sheet_flows
    )
    leaves = {"from": "readTemperature.tempEthPacket", "to": "eth_rgmii.tempEthPacket"}
    assert leaves in sheet_flows


def test_the_seven_rows_read_back_valid_and_fully_wired(seven_rows):
    report = seven_rows.report()
    action = report.actions[0]
    assert [step.name for step in action.steps] == [row[1] for row in ROWS]
    unwired = [flow for flow in action.flows if flow.wired is not True]
    assert unwired == []
    assert not [p for p in report.problems if "ReadTemperature" in p or PERFORM in p]


def test_a_row_set_before_its_feeder_is_linked_when_the_feeder_comes(wifi):
    session = Session(wifi)
    start_over(session)
    session.run(
        "add_step", sheet=TOP, perform=PERFORM, name="receiveFrame", part="ethernet"
    )
    session.run(
        "add_step", sheet=TOP, perform=PERFORM, name="readFrame", part="Control"
    )
    session.end(
        "readFrame", "in", port="eth_int", newPortItem={"name": "int", "type": "Int"}
    )
    assert "flows" not in session.action_def("ReadTemperature")
    result = session.end(
        "receiveFrame",
        "out",
        port="Interrupt",
        newPortItem={"name": "int", "type": "Int"},
    )
    assert session.action_def("ReadTemperature")["flows"] == [
        {"from": "receiveFrame.int", "to": "readFrame.int", "succession": True}
    ]
    assert "readFrame.int gets receiveFrame.int" in " ".join(result.notes)  # fmt: skip


def test_no_wire_no_link(wifi):
    session = Session(wifi)
    start_over(session)
    session.run("delete_wire", sheet=TOP, a="ethernet.Interrupt", b="Control.eth_int")
    session.run(
        "add_step", sheet=TOP, perform=PERFORM, name="receiveFrame", part="ethernet"
    )
    session.run(
        "add_step", sheet=TOP, perform=PERFORM, name="readFrame", part="Control"
    )
    session.end(
        "receiveFrame",
        "out",
        port="Interrupt",
        newPortItem={"name": "int", "type": "Int"},
    )
    session.end(
        "readFrame", "in", port="eth_int", newPortItem={"name": "int", "type": "Int"}
    )
    assert "flows" not in session.action_def("ReadTemperature")
    session.run("connect", sheet=TOP, a="ethernet.Interrupt", b="Control.eth_int")
    session.run("link_actions", sheet=TOP, perform=PERFORM)
    assert len(session.action_def("ReadTemperature")["flows"]) == 1  # fmt: skip


def test_no_port_clears_the_line_and_its_links(seven_rows):
    seven_rows.end("readFrame", "in", item="int")
    read_temperature = seven_rows.action_def("ReadTemperature")
    assert not any(f["to"] == "readFrame.int" for f in read_temperature["flows"])
    control = seven_rows.part_def("Control")
    assert not any(f["to"] == "readFrame.int" for f in control["flows"])


# ---------------------------------------------------------------- refusals


def test_refusals_change_nothing(seven_rows):
    before = copy.deepcopy(seven_rows.docs)
    assert (
        seven_rows.refused(
            "set_action_end",
            sheet=TOP,
            perform=PERFORM,
            step="readFrame",
            direction="sideways",
            port="eth_int",
            portItem="int",
        )
        == "bad_request"
    )
    assert (
        seven_rows.refused(
            "set_action_end",
            sheet=TOP,
            perform=PERFORM,
            step="readFrame",
            direction="in",
            port="eth_int",
        )
        == "bad_request"
    )  # no item said
    assert (
        seven_rows.refused(
            "set_action_end",
            sheet=TOP,
            perform=PERFORM,
            step="readFrame",
            direction="out",
            port="eth_int",
            portItem="int",
        )
        == "direction"
    )  # eth_int.int is in
    assert (
        seven_rows.refused(
            "set_action_end",
            sheet=TOP,
            perform=PERFORM,
            step="readFrame",
            direction="in",
            item="int",
            port="ethernet",
            newPortItem={"name": "frame", "type": "EthPacket"},
        )
        == "types"
    )  # int is Int
    assert (
        seven_rows.refused(
            "set_action_end",
            sheet=TOP,
            perform=PERFORM,
            step="readFrame",
            direction="in",
            port="nope",
            portItem="int",
        )
        == "not_found"
    )
    assert seven_rows.docs == before  # fmt: skip


def test_ip_brings_its_own_items(wifi):
    session = Session(wifi)
    vendor = session.run(
        "add_part", sheet=TOP, name="vendor_mac", kind="VendorIp"
    ).data["type"]
    session.run("add_port", **{"def": vendor, "name": "rx", "type": "BitIn"})
    session.run("add_perform", **{"def": vendor, "action": "MacReceive"})
    session.run(
        "add_step",
        sheet=TOP,
        perform=PERFORM,
        name="macRx",
        part="vendor_mac",
        action="MacReceive",
    )
    assert session.refused(
        "set_action_end", sheet=TOP, perform=PERFORM, step="macRx", direction="in",
        port="rx", newPortItem={"name": "bit", "type": "Int"},
    ) == "ip_actions"  # fmt: skip


# ---------------------------------------------------------------- replace, remove


def test_a_line_replaces_an_item_of_another_item_def(wifi):
    # What the user did by hand: ReceiveFrame's old cmd : Command, replaced
    # on the Interrupt port by int : Int (one operation, one undo step).
    session = Session(wifi)
    session.run(
        "add_port", **{"def": "Ethernet", "name": "Interrupt", "type": "BitOut"}
    )
    session.end(
        "receiveFrame",
        "out",
        port="Interrupt",
        newPortItem={"name": "int", "type": "Int"},
        replaces="cmd",
    )
    parameters = session.action_def("ReceiveFrame")["parameters"]
    assert {"name": "int", "direction": "out", "type": "Int"} in parameters
    assert not any(p["name"] == "cmd" for p in parameters)
    ethernet_flows = session.part_def("Ethernet")["flows"]
    assert {"from": "receiveFrame.int", "to": "Interrupt.int"} in ethernet_flows
    assert not any("receiveFrame.cmd" in (f["from"], f["to"]) for f in ethernet_flows)
    session.report()  # valid  # fmt: skip


def test_replacing_is_refused_before_anything_changes(wifi):
    session = Session(wifi)
    before = copy.deepcopy(session.docs)
    assert (
        session.refused(
            "set_action_end",
            sheet=TOP,
            perform=PERFORM,
            step="receiveFrame",
            direction="out",
            port="cmd",
            newPortItem={"name": "bad name", "type": "Int"},
            replaces="cmd",
        )
        == "bad_name"
    )
    assert (
        session.refused(
            "set_action_end",
            sheet=TOP,
            perform=PERFORM,
            step="receiveFrame",
            direction="in",
            port="cmd",
            newPortItem={"name": "x", "type": "Int"},
            replaces="cmd",
        )
        == "direction"
    )  # cmd is out
    assert session.docs == before  # fmt: skip


def test_delete_port_item_and_its_flows(wifi):
    session = Session(wifi)
    result = session.run("delete_port_item", **{"def": "Ethernet", "item": "cmd.cmd"})
    cmd = next(u for u in session.part_def("Ethernet")["ports"] if u["name"] == "cmd")
    assert [i["name"] for i in cmd["items"]] == ["response"]
    assert {"from": "receiveFrame.cmd", "to": "cmd.cmd"} not in session.part_def(
        "Ethernet"
    )["flows"]
    assert result.notes == ["Removed 1 flow(s) to cmd.cmd."]
    assert (
        session.refused("delete_port_item", **{"def": "Ethernet", "item": "cmd.nope"})
        == "not_found"
    )
