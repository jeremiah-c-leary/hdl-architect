"""The walk (core.action_walk): a composite action def built by following
the data through the sheet, one action def at each part. The data is the
user's seven rows for ReadTemperature (2026-11-26): made once with hops, so
their action defs know their ports; then the actions are deleted and the
same path is walked again, picking those action defs."""

import copy

from test_action_hops import click_through
from test_action_links import PERFORM, TOP, Session, start_over, succession, wifi

_ = wifi  # a fixture, used by name

# The walk: where it arrives (part, port), the action def picked there, and
# the exit it leaves by.
WALK = [
    (("ethernet", "eth_rgmii"), "ReceiveFrame", "Interrupt"),
    (("Control", "eth_int"), "ReadFrame", "ethernet"),
    (("ethernet", "cmd"), "RxFrameReq", "cmd"),
    (("Control", "ethernet"), "RequestTemp", "temp_if"),
    (("temp_if", "temp_read"), "ReturnTemp", "temp_read"),
    (("Control", "temp_if"), "ForwardTemp", "ethernet"),
    (("ethernet", "cmd"), "TransmitFrame", "eth_rgmii"),
]


def walked(wifi) -> Session:
    """The seven action defs, made once; then no actions, and the walk."""
    session = Session(wifi)
    start_over(session)
    click_through(session)
    actions = session.action_def("ReadTemperature")["actions"]
    for step in [action["name"] for action in actions]:
        session.run("delete_step", sheet=TOP, perform=PERFORM, step=step)
    came_from = {"step": None, "port": "eth_rgmii"}
    for (part, port), action, exit_port in WALK:
        result = walk_to(session, came_from, (part, port), (action, exit_port))
        came_from = {"step": result.data["step"], "port": exit_port}
    return session


def walk_to(session: Session, came_from: dict, at: tuple, picked: tuple):
    action, exit_port = picked
    return session.run(
        "walk_step",
        sheet=TOP,
        perform=PERFORM,
        **{"from": came_from},
        at={"part": at[0], "port": at[1]},
        action=action,
        exit=exit_port,
    )


def test_walking_the_path_gives_the_seven_rows_again(wifi):
    session = walked(wifi)
    read_temperature = session.action_def("ReadTemperature")
    assert [action["name"] for action in read_temperature["actions"]] == [
        "receiveFrame",
        "readFrame",
        "rxFrameReq",
        "requestTemp",
        "returnTemp",
        "forwardTemp",
        "transmitFrame",
    ]
    assert read_temperature["flows"] == [
        succession("receiveFrame.int", "readFrame.int"),
        succession("readFrame.axi4liteRead", "rxFrameReq.axi4liteRead"),
        succession("rxFrameReq.ethPacket", "requestTemp.ethPacket"),
        succession("requestTemp.axi4liteRead", "returnTemp.axi4liteRead"),
        succession("returnTemp.tempReading", "forwardTemp.tempReading"),
        succession("forwardTemp.tempEthPacket", "transmitFrame.tempEthPacket"),
    ]
    assert read_temperature["bindings"] == [
        {"ends": ["receiveFrame.ethPacket", "ethPacket"]},
        {"ends": ["transmitFrame.tempEthPacket_2", "tempEthPacket"]},
    ]
    report = session.report()
    unwired = [flow for flow in report.actions[0].flows if flow.wired is not True]
    assert unwired == []


def test_a_walk_needs_a_wire_and_a_way_in_and_a_refusal_changes_nothing(wifi):
    session = walked(wifi)
    before = copy.deepcopy(session.docs)
    came_from = {"step": "transmitFrame", "port": "eth_rgmii"}
    no_wire = session.refused(
        "walk_step",
        sheet=TOP,
        perform=PERFORM,
        **{"from": came_from},
        at={"part": "Control", "port": "eth_int"},
        action="ReadFrame",
    )
    assert no_wire == "no_wire"
    assert session.docs == before
    came_from = {"step": "receiveFrame", "port": "Interrupt"}
    no_way_in = session.refused(
        "walk_step",
        sheet=TOP,
        perform=PERFORM,
        **{"from": came_from},
        at={"part": "Control", "port": "eth_int"},
        action="ForwardTemp",  # it comes in by temp_if
    )
    assert no_way_in == "no_line"
