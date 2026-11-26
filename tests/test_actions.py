"""Performed actions (core.actions): who performs each step of an action, the
ports its items use, and the wires the items need; `ha report actions`; and
the operations keeping part-def flows in step with renamed or deleted ports."""

import json
import shutil
from pathlib import Path

import pytest

from hdl_architect.cli import main as ha
from hdl_architect.core.actions import (
    DECOMPOSED,
    NOT_ALLOCATED,
    NOT_PERFORMED,
    PERFORMED,
    TO_BREAK_DOWN,
    action_report,
)

# A frozen copy of the Wi-Fi example (not the example the user edits).
WIFI = Path(__file__).resolve().parent / "ha2" / "fixtures" / "wifi_router_estimates"
TOP = "WifiPacketRouterFpga"
SUBSYSTEMS = "wifi_packet_router_subsystems.json"
FPGA = "wifi_packet_router_fpga.json"
BEHAVIOUR = "wifi_packet_router_behavior.json"

MISSING_WIRES = [
    f"{TOP}: cmd (receiveFrame.cmd -> decodeCommand.cmd): no wire from "
    "ethernet.cmd to processing.Control",
    f"{TOP}: request (decodeCommand.request -> readSensor.request): no wire from "
    "processing.Control to temp_if.temp_read",
    f"{TOP}: temperature (readSensor.temperature -> buildResponse.temperature): "
    "no wire from temp_if.temp_read to processing.Control",
    f"{TOP}: response (buildResponse.response -> sendFrame.response): no wire "
    "from processing.Control to ethernet.cmd",
]


@pytest.fixture
def wifi_copy(tmp_path):
    shutil.copytree(WIFI, tmp_path / "wifi")
    return tmp_path / "wifi"


def change(model_dir: Path, file: str, edit) -> None:
    """Apply `edit(package)` to one copied model file."""
    path = model_dir / file
    doc = json.loads(path.read_text())
    edit(doc["package"])
    path.write_text(json.dumps(doc, indent=2))


def part_def(package: dict, name: str) -> dict:
    return next(d for d in package["partDefs"] if d["name"] == name)


def steps_of(report):
    return {step.name: step for step in report.actions[0].steps}


# ------------------------------------------------------------------ the example


def test_read_temperature_step_by_step():
    report = action_report([WIFI], TOP)
    action = report.actions[0]
    assert (action.owner, action.name, action.action_def) == (
        TOP,
        "readTemperature",
        "ReadTemperature",
    )
    assert [(i.item, i.direction, i.port) for i in action.items] == [
        ("cmdFrame", "in", "eth_rgmii"),
        ("rspFrame", "out", "eth_rgmii"),
    ]
    steps = steps_of(report)
    assert [(s.name, s.part, s.status) for s in steps.values()] == [
        ("receiveFrame", "ethernet", TO_BREAK_DOWN),  # a Subsystem without parts
        ("decodeCommand", "processing", TO_BREAK_DOWN),
        ("readSensor", "temp_if", PERFORMED),  # an Rtl leaf
        ("buildResponse", "processing", TO_BREAK_DOWN),
        ("sendFrame", "ethernet", TO_BREAK_DOWN),
    ]
    assert [(i.item, i.port) for i in steps["readSensor"].items] == [
        ("request", "temp_read"),
        ("temperature", "temp_read"),
    ]


def test_the_items_that_have_no_wire_to_travel_on():
    assert action_report([WIFI], TOP).problems == MISSING_WIRES


def test_one_wire_carries_items_both_ways(wifi_copy):
    def wire_ethernet_to_processing(package):
        part_def(package, TOP)["connections"].append(
            {"ends": ["ethernet.cmd", "processing.Control"]}
        )

    change(wifi_copy, FPGA, wire_ethernet_to_processing)
    problems = action_report([wifi_copy], TOP).problems
    assert problems == [MISSING_WIRES[1], MISSING_WIRES[2]]  # cmd and response


# ------------------------------------------------------------------ problems


def test_a_step_its_part_does_not_perform(wifi_copy):
    def stop_decoding(package):
        processing = part_def(package, "Processing")
        processing["performs"] = [
            p for p in processing["performs"] if p["name"] != "decodeCommand"
        ]

    change(wifi_copy, SUBSYSTEMS, stop_decoding)
    report = action_report([wifi_copy], TOP)
    assert steps_of(report)["decodeCommand"].status == NOT_PERFORMED
    assert (
        f"{TOP}: readTemperature.decodeCommand: Processing does not perform "
        "DecodeCommand" in report.problems
    )


def test_an_item_whose_port_is_not_said(wifi_copy):
    def forget_the_port(package):
        sensor = part_def(package, "TempSensorInterface")
        sensor["flows"] = [
            f for f in sensor["flows"] if f["from"] != "temp_read.request"
        ]

    change(wifi_copy, SUBSYSTEMS, forget_the_port)
    report = action_report([wifi_copy], TOP)
    request = steps_of(report)["readSensor"].items[0]
    assert (request.item, request.port) == ("request", None)
    assert (
        "TempSensorInterface: readSensor.request does not say which port it "
        "enters by (a flow between a port's item and readSensor.request)"
        in report.problems
    )


def test_a_port_that_does_not_carry_the_item(wifi_copy):
    def drop_the_port_s_item(package):
        sensor = part_def(package, "TempSensorInterface")
        port = next(p for p in sensor["ports"] if p["name"] == "temp_read")
        port["items"] = [i for i in port["items"] if i["name"] != "temperature"]

    change(wifi_copy, SUBSYSTEMS, drop_the_port_s_item)
    report = action_report([wifi_copy], TOP)
    assert (
        "TempSensorInterface: port temp_read does not carry out item temperature"
        in report.problems
    )


def test_a_step_no_part_does(wifi_copy):
    def unallocate(package):
        top = part_def(package, TOP)
        top["allocations"] = [
            a for a in top["allocations"] if not a["from"].endswith(".readSensor")
        ]

    change(wifi_copy, FPGA, unallocate)
    report = action_report([wifi_copy], TOP)
    assert steps_of(report)["readSensor"].status == NOT_ALLOCATED
    assert (
        f"{TOP}: readTemperature.readSensor is not allocated to a part"
        in report.problems
    )


def test_an_item_at_the_sheet_s_edge_needs_its_wire(wifi_copy):
    def unwire_the_ethernet_port(package):
        top = part_def(package, TOP)
        top["bindings"] = [
            b for b in top["bindings"] if "ethernet.eth_rgmii" not in b["ends"]
        ]

    change(wifi_copy, FPGA, unwire_the_ethernet_port)
    problems = action_report([wifi_copy], TOP).problems
    assert (
        f"{TOP}: cmdFrame: no wire from the sheet's eth_rgmii to ethernet.eth_rgmii"
        in problems
    )
    assert (
        f"{TOP}: rspFrame: no wire from the sheet's eth_rgmii to ethernet.eth_rgmii"
        in problems
    )


# ------------------------------------------------------------------ one level down


def test_a_step_broken_down_into_steps_on_the_part_s_own_parts(wifi_copy):
    """DecodeCommand gets a step of its own, on a part inside Processing."""

    def decompose_decoding(package):
        decode = next(a for a in package["actionDefs"] if a["name"] == "DecodeCommand")
        decode["actions"] = [{"name": "parse", "type": "ParseCommand"}]
        package["actionDefs"].append(
            {
                "name": "ParseCommand",
                "parameters": [
                    {"name": "cmd", "direction": "in", "type": "Command"},
                    {
                        "name": "request",
                        "direction": "out",
                        "type": "TemperatureRequest",
                    },
                ],
            }
        )

    def add_the_parser(package):
        processing = part_def(package, "Processing")
        processing["parts"] = [{"name": "parser", "type": "CommandParser"}]
        processing["allocations"] = [{"from": "decodeCommand.parse", "to": "parser"}]
        package["partDefs"].append(
            {
                "name": "CommandParser",
                "specializes": ["Rtl"],
                "performs": [{"name": "parse", "type": "ParseCommand"}],
            }
        )

    change(wifi_copy, BEHAVIOUR, decompose_decoding)
    change(wifi_copy, SUBSYSTEMS, add_the_parser)
    decode = steps_of(action_report([wifi_copy], TOP))["decodeCommand"]
    assert decode.status == DECOMPOSED
    assert [(s.name, s.part, s.part_def) for s in decode.steps] == [
        ("parse", "parser", "CommandParser")
    ]
    assert decode.steps[0].status == PERFORMED


# ------------------------------------------------------------------ the report


def test_the_report(capsys):
    assert ha(["report", "actions", "--path", str(WIFI), "--top", TOP]) == 1
    out = capsys.readouterr().out
    assert f"{TOP} performs readTemperature : ReadTemperature" in out
    assert (
        "  3. readSensor : ReadSensor, by temp_if : TempSensorInterface (performed)"
        in out
    )
    assert "     gets request : TemperatureRequest via temp_read.request" in out
    assert f"error: {MISSING_WIRES[0]}" in out


# ------------------------------------------------------------------ operations


def test_renaming_a_port_renames_it_in_the_flows(wifi_copy):
    from hdl_architect.core import ops
    from hdl_architect.core.files import read_model_files, write_model_file

    docs = read_model_files([wifi_copy])
    model = ops.Model(docs)
    ops.rename_port(model, "TempSensorInterface", "temp_read", "csr")
    flows = model.part_def("TempSensorInterface")[2]["flows"]
    assert flows == [
        {"from": "csr.request", "to": "readSensor.request"},
        {"from": "readSensor.temperature", "to": "csr.temperature"},
    ]
    for file, doc in docs.items():
        write_model_file(file, doc)
    report = action_report([wifi_copy], TOP)
    assert [i.port for i in steps_of(report)["readSensor"].items] == ["csr", "csr"]


def test_deleting_a_port_removes_its_flows_and_says_so(wifi_copy):
    from hdl_architect.core import ops
    from hdl_architect.core.files import read_model_files

    model = ops.Model(read_model_files([wifi_copy]))
    result = ops.delete_port(model, "TempSensorInterface", "temp_read")
    assert "flows" not in model.part_def("TempSensorInterface")[2]
    assert (
        "Removed 2 flow(s) through temp_read: those items no longer say which "
        "port they use." in result.notes
    )


# ------------------------------------------------------------------ SysML text


def test_the_sysml_text_has_the_performs_and_their_flows(tmp_path):
    assert ha(["gen", "sysml", "--path", str(WIFI), "--out", str(tmp_path)]) == 0
    text = (tmp_path / "WifiPacketRouterSubsystems.sysml").read_text()
    assert "        perform action readSensor : ReadSensor;" in text
    assert "            in item request : TemperatureRequest;" in text  # the port's
    assert "        flow from temp_read.request to readSensor.request;" in text
    assert "        flow from readSensor.temperature to temp_read.temperature;" in text
