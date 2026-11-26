"""Operations on performed actions (core.action_ops), through ops.run as every
front end calls them. Each test edits a scratch copy of the frozen Wi-Fi
fixture, writes it, and reads it back with the walk (core.actions), which
also validates every file against the schema."""

import shutil
from pathlib import Path

import pytest

from hdl_architect.cli import main as ha
from hdl_architect.core import ops
from hdl_architect.core.actions import (
    NOT_ALLOCATED,
    PERFORMED,
    TO_BREAK_DOWN,
    action_report,
)
from hdl_architect.core.files import read_model_files, write_model_file

WIFI = Path(__file__).resolve().parent / "ha2" / "fixtures" / "wifi_router_estimates"
TOP = "WifiPacketRouterFpga"
FPGA = "wifi_packet_router_fpga.json"
SUBSYSTEMS = "wifi_packet_router_subsystems.json"
BEHAVIOUR = "wifi_packet_router_behavior.json"


@pytest.fixture
def wifi(tmp_path):
    copy = tmp_path / "wifi"
    shutil.copytree(WIFI, copy)
    return copy


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

    def part_def(self, name: str) -> dict:
        return self.model.part_def(name)[2]

    def action_def(self, name: str) -> dict:
        return self.model.action_defs[name][2]

    def file(self, name: str) -> str:
        return str(self.folder / name)

    def report(self):
        """Write the files and walk the actions the FPGA performs."""
        for file, doc in self.docs.items():
            write_model_file(Path(file), doc)
        return action_report([self.folder], TOP)


def steps_of(report) -> dict:
    return {step.name: step for step in report.actions[0].steps}


# ---------------------------------------------------------------- performs


def test_add_perform_of_a_new_action_def_goes_in_the_part_defs_package(wifi):
    session = Session(wifi)
    result = session.run("add_perform", **{"def": "Uart", "action": "SendStatus"})
    assert session.part_def("Uart")["performs"] == [
        {"name": "sendStatus", "type": "SendStatus"}
    ]
    assert result.data == {"name": "sendStatus"}
    assert result.notes == [
        "New action def SendStatus in package WifiPacketRouterSubsystems."
    ]
    assert result.changed == [session.file(SUBSYSTEMS)]


def test_add_perform_of_an_existing_action_def_imports_its_package(wifi):
    session = Session(wifi)
    result = session.run(
        "add_perform", **{"def": "Uart", "action": "ReadSensor", "name": "poll"}
    )
    assert {"name": "poll", "type": "ReadSensor"} in session.part_def("Uart")[
        "performs"
    ]
    assert result.notes == []
    session.report()  # valid, and the type resolves


def test_add_perform_refusals(wifi):
    session = Session(wifi)
    assert (
        session.refused("add_perform", **{"def": "Ethernet", "action": "SendFrame"})
        == "exists"
    )
    assert (
        session.refused(
            "add_perform", **{"def": "Uart", "action": "ReadSensor", "name": "bad name"}
        )
        == "bad_name"
    )
    assert (
        session.refused("add_perform", **{"def": "Nope", "action": "X"}) == "not_found"
    )


def test_delete_perform_removes_its_flows_and_allocations(wifi):
    session = Session(wifi)
    result = session.run("delete_perform", **{"def": TOP, "perform": "readTemperature"})
    top = session.part_def(TOP)
    assert "performs" not in top
    assert "flows" not in top
    assert "allocations" not in top
    assert result.notes == [
        "Removed 2 flow(s): which ports readTemperature's items use.",
        "Removed 5 allocation(s) of readTemperature's steps.",
    ]
    assert "ReadTemperature" in session.model.action_defs  # the def stays


# ---------------------------------------------------------------- steps


def test_a_step_on_a_subsystem_becomes_an_action_it_must_perform(wifi):
    session = Session(wifi)
    result = session.run(
        "add_step",
        sheet=TOP,
        perform="readTemperature",
        name="logReading",
        part="Control",
    )
    assert result.notes == [
        # Control's def is in the FPGA's file and package
        "New action def LogReading in package WifiPacketRouterFpgaSys.",
        "Control now performs logReading : LogReading.",
    ]
    assert result.changed == sorted(session.file(f) for f in (BEHAVIOUR, FPGA))
    steps = session.action_def("ReadTemperature")["actions"]
    assert steps[-1] == {"name": "logReading", "type": "LogReading"}
    assert {"from": "readTemperature.logReading", "to": "Control"} in session.part_def(
        TOP
    )["allocations"]
    step = steps_of(session.report())["logReading"]
    assert (step.part, step.status) == ("Control", TO_BREAK_DOWN)


def test_a_step_on_a_leaf_with_an_existing_action_def_is_performed(wifi):
    session = Session(wifi)
    session.run(
        "add_step",
        sheet=TOP,
        perform="readTemperature",
        name="readAgain",
        part="uart",
        action="ReadSensor",
    )
    assert {"name": "readSensor", "type": "ReadSensor"} in session.part_def("Uart")[
        "performs"
    ]
    step = steps_of(session.report())["readAgain"]
    assert (step.part, step.status) == ("uart", PERFORMED)


def test_ip_brings_its_own_actions(wifi):
    session = Session(wifi)
    session.run("add_part", sheet=TOP, name="macro", **{"def": "HardMacro2"})
    step = {"sheet": TOP, "perform": "readTemperature", "name": "boot", "part": "macro"}
    assert session.refused("add_step", **step) == "ip_actions"
    assert "Boot" not in session.model.action_defs  # nothing made
    assert session.refused("add_step", **step, action="ReadSensor") == "ip_actions"
    session.run("add_perform", **{"def": "HardMacro2", "action": "Boot"})
    session.run("add_step", **step, action="Boot")  # one it performs


def test_add_step_refusals(wifi):
    session = Session(wifi)
    step = {"sheet": TOP, "perform": "readTemperature", "part": "uart"}
    assert session.refused("add_step", **step, name="readSensor") == "exists"
    assert session.refused("add_step", **step, name="2bad") == "bad_name"
    assert session.refused("add_step", **{**step, "part": "nope"}, name="x") == (
        "not_found"
    )
    assert session.refused("add_step", **{**step, "perform": "nope"}, name="x") == (
        "not_found"
    )


def test_set_step_part_moves_the_step_and_its_part_performs_it(wifi):
    session = Session(wifi)
    result = session.run(
        "set_step_part",
        sheet=TOP,
        perform="readTemperature",
        step="decodeCommand",
        part="Control",
    )
    assert result.notes == ["Control now performs decodeCommand : DecodeCommand."]
    allocations = session.part_def(TOP)["allocations"]
    assert {"from": "readTemperature.decodeCommand", "to": "Control"} in allocations
    assert {
        "from": "readTemperature.decodeCommand",
        "to": "processing",
    } not in allocations
    step = steps_of(session.report())["decodeCommand"]
    assert (step.part, step.status) == ("Control", TO_BREAK_DOWN)


def test_set_step_action_drops_flows_to_items_the_new_def_lacks(wifi):
    session = Session(wifi)
    session.run("add_perform", **{"def": "Processing", "action": "Decode2"})
    result = session.run(
        "set_step_action",
        sheet=TOP,
        perform="readTemperature",
        step="decodeCommand",
        action="Decode2",
    )
    assert result.notes == [
        "Removed 2 flow(s) and binding(s) to decodeCommand's items."
    ]
    action = session.action_def("ReadTemperature")
    types = {step["name"]: step["type"] for step in action["actions"]}
    assert types["decodeCommand"] == "Decode2"
    assert all("decodeCommand" not in flow["from"] for flow in action["flows"])
    session.report()


def test_delete_step_removes_its_flows_and_allocation(wifi):
    session = Session(wifi)
    result = session.run(
        "delete_step", sheet=TOP, perform="readTemperature", step="readSensor"
    )
    assert result.notes == ["Removed 2 flow(s) and binding(s) to readSensor's items."]
    assert result.changed == sorted(session.file(f) for f in (BEHAVIOUR, FPGA))
    names = [s["name"] for s in session.action_def("ReadTemperature")["actions"]]
    assert "readSensor" not in names
    assert all(
        a["from"] != "readTemperature.readSensor"
        for a in session.part_def(TOP)["allocations"]
    )
    assert "readSensor" not in steps_of(session.report())


def test_move_step(wifi):
    session = Session(wifi)
    session.run(
        "move_step", sheet=TOP, perform="readTemperature", step="sendFrame", index=0
    )
    names = [s["name"] for s in session.action_def("ReadTemperature")["actions"]]
    assert names[0] == "sendFrame"
    assert (
        session.refused(
            "move_step", sheet=TOP, perform="readTemperature", step="sendFrame", index=9
        )
        == "bad_request"
    )


def test_a_step_with_no_allocation_is_reported(wifi):
    session = Session(wifi)
    session.run("add_step", sheet=TOP, perform="readTemperature", name="x", part="uart")
    session.part_def(TOP)["allocations"].pop()
    assert steps_of(session.report())["x"].status == NOT_ALLOCATED


# ---------------------------------------------------------------- items


def test_add_action_item_makes_its_item_def(wifi):
    session = Session(wifi)
    result = session.run(
        "add_action_item",
        action="ReadSensor",
        name="alarm",
        direction="out",
        type="Alarm",
    )
    assert result.notes == ["New item def Alarm in package WifiPacketRouterBehavior."]
    assert {"name": "alarm", "direction": "out", "type": "Alarm"} in session.action_def(
        "ReadSensor"
    )["parameters"]
    assert (
        session.refused(
            "add_action_item",
            action="ReadSensor",
            name="alarm",
            direction="out",
            type="Alarm",
        )
        == "exists"
    )
    assert (
        session.refused(
            "add_action_item", action="ReadSensor", name="y", direction="up", type="X"
        )
        == "bad_request"
    )


def test_delete_action_item_removes_what_refers_to_it(wifi):
    session = Session(wifi)
    result = session.run("delete_action_item", action="ReadSensor", item="request")
    # the flow decodeCommand.request -> readSensor.request, and TempSensorInterface's
    # flow temp_read.request -> readSensor.request
    assert result.notes == [
        "Removed what referred to request: 2 flow(s) or binding(s)."
    ]
    flows = session.part_def("TempSensorInterface")["flows"]
    assert all("request" not in flow["to"] for flow in flows)
    session.report()


def test_connect_items_between_steps_is_a_succession_flow(wifi):
    session = Session(wifi)
    session.run(
        "disconnect_items",
        action="ReadTemperature",
        **{"from": "receiveFrame.cmd", "to": "decodeCommand.cmd"},
    )
    flows = session.action_def("ReadTemperature")["flows"]
    assert {
        "from": "receiveFrame.cmd",
        "to": "decodeCommand.cmd",
        "succession": True,
    } not in flows
    session.run(
        "connect_items",
        action="ReadTemperature",
        **{"from": "receiveFrame.cmd", "to": "decodeCommand.cmd"},
    )
    assert flows[-1:] != []  # the list object was replaced: read it again
    assert {
        "from": "receiveFrame.cmd",
        "to": "decodeCommand.cmd",
        "succession": True,
    } in session.action_def("ReadTemperature")["flows"]


def test_connect_items_to_the_actions_own_item_is_a_binding(wifi):
    session = Session(wifi)
    session.run(
        "disconnect_items",
        action="ReadTemperature",
        **{"from": "cmdFrame", "to": "receiveFrame.ethFrame"},
    )
    session.run(
        "connect_items",
        action="ReadTemperature",
        **{"from": "cmdFrame", "to": "receiveFrame.ethFrame"},
    )
    assert {"ends": ["receiveFrame.ethFrame", "cmdFrame"]} in session.action_def(
        "ReadTemperature"
    )["bindings"]


def test_connect_items_refusals(wifi):
    session = Session(wifi)

    def refused(source, target):
        return session.refused(
            "connect_items", action="ReadTemperature", **{"from": source, "to": target}
        )

    assert refused("receiveFrame.cmd", "decodeCommand.cmd") == "exists"
    assert refused("decodeCommand.cmd", "receiveFrame.cmd") == "direction"  # backwards
    assert refused("receiveFrame.cmd", "readSensor.request") == "types"
    assert refused("rspFrame", "receiveFrame.ethFrame") == "direction"  # an out item
    assert refused("receiveFrame.nope", "decodeCommand.cmd") == "not_found"


# ---------------------------------------------------------------- item via port


def test_set_item_port_adds_the_port_item_and_the_flow(wifi):
    session = Session(wifi)
    result = session.run(
        "set_item_port",
        **{
            "def": "Processing",
            "perform": "decodeCommand",
            "item": "cmd",
            "port": "dac_if",
        },
    )
    assert result.notes == ["Port dac_if now carries in item cmd : Command."]
    processing = session.part_def("Processing")
    assert {"from": "dac_if.cmd", "to": "decodeCommand.cmd"} in processing["flows"]
    assert {"from": "Control.cmd", "to": "decodeCommand.cmd"} not in processing["flows"]


def test_set_item_port_uses_a_named_port_item_and_can_clear(wifi):
    session = Session(wifi)
    args = {"def": "Ethernet", "perform": "receiveFrame", "item": "ethFrame"}
    session.run("set_item_port", **args, port="eth_rgmii", portItem="rxFrame")
    flows = session.part_def("Ethernet")["flows"]
    assert (
        flows.count({"from": "eth_rgmii.rxFrame", "to": "receiveFrame.ethFrame"}) == 1
    )
    assert (
        session.refused("set_item_port", **args, port="eth_rgmii", portItem="txFrame")
        == "direction"
    )
    result = session.run("set_item_port", **args)
    assert result.notes == ["receiveFrame.ethFrame no longer says which port it uses."]
    report = session.report()
    assert any(
        "receiveFrame.ethFrame does not say which port" in p for p in report.problems
    )


# ---------------------------------------------------------------- the command line


def test_ha_op_runs_an_action_operation(wifi, capsys):
    code = ha(
        [
            "op",
            "add_step",
            f"sheet={TOP}",
            "perform=readTemperature",
            "name=logReading",
            "part=Control",
            "--path",  # options last: Python 3.11's argparse needs it
            str(wifi),
        ]
    )
    assert code == 0
    assert "Control now performs logReading : LogReading." in capsys.readouterr().out
    steps = steps_of(action_report([wifi], TOP))
    assert steps["logReading"].status == TO_BREAK_DOWN
