"""Hops of the actions table (core.action_hops): one item from one action to
the next over one wire, said once so both ends agree. The data is the
user's seven rows for ReadTemperature (2026-11-26), entered the way the
table enters them when the user clicks source ports on the sheet: each
click a hop, and a new action at its far end."""

import copy

from test_action_links import (  # the same scratch copy and starting point
    PERFORM,
    ROWS,
    TOP,
    Session,
    start_over,
    succession,
    wifi,
)

_ = wifi  # a fixture, used by name

# The clicks: the port clicked (None: the sheet's own), the port at the far
# end of its wire, the new action there (part, action def), and the item.
CLICKS = [
    ((None, "eth_rgmii"), "eth_rgmii", ("ethernet", "ReceiveFrame"),
     ("ethPacket", "EthPacket")),
    (("receiveFrame", "Interrupt"), "eth_int", ("Control", "ReadFrame"),
     ("int", "Int")),
    (("readFrame", "ethernet"), "cmd", ("ethernet", "RxFrameReq"),
     ("axi4liteRead", "Axi4LiteRead")),
    (("rxFrameReq", "cmd"), "ethernet", ("Control", "RequestTemp"),
     ("ethPacket", "EthPacket")),
    (("requestTemp", "temp_if"), "temp_read", ("temp_if", "ReturnTemp"),
     ("axi4liteRead", "Axi4LiteRead")),
    (("returnTemp", "temp_read"), "temp_if", ("Control", "ForwardTemp"),
     ("tempReading", "TempReading")),
    (("forwardTemp", "ethernet"), "cmd", ("ethernet", "TransmitFrame"),
     ("tempEthPacket", "TempEthPacket")),
]  # fmt: skip


def hop(session: Session, source: dict, target: dict, item: tuple):
    name, type_ = item
    return session.run(
        "set_hop",
        sheet=TOP,
        perform=PERFORM,
        source=source,
        target=target,
        item={"name": name, "type": type_},
    )


def click_through(session: Session) -> list[str]:
    """The seven clicks, then the last one: transmitFrame out to the sheet."""
    made = []
    for (step, port), far_port, (part, action), item in CLICKS:
        source = {"step": step, "port": port}
        target = {
            "step": None,
            "port": far_port,
            "new": {"part": part, "action": action},
        }
        made.append(hop(session, source, target, item).data["target"])
    last = {"step": "transmitFrame", "port": "eth_rgmii"}
    hop(session, last, {"step": None, "port": "eth_rgmii"}, CLICKS[-1][3])
    return made


def test_clicking_source_ports_builds_the_seven_rows(wifi):
    session = Session(wifi)
    start_over(session)
    made = click_through(session)
    assert made == [row[1] for row in ROWS], "each new action named after its def"
    read_temperature = session.action_def("ReadTemperature")
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
    assert not [p for p in report.problems if "ReadTemperature" in p or PERFORM in p]


def test_a_hop_between_two_actions_uses_the_items_their_ports_have(wifi):
    session = Session(wifi)
    start_over(session)
    click_through(session)
    ethernet = session.part_def("Ethernet")
    interrupt = next(u for u in ethernet["ports"] if u["name"] == "Interrupt")
    assert interrupt["items"] == [{"name": "int", "direction": "out", "type": "Int"}]
    control = session.part_def("Control")
    eth_int = next(u for u in control["ports"] if u["name"] == "eth_int")
    assert eth_int["items"] == [{"name": "int", "direction": "in", "type": "Int"}]


def test_a_new_item_def_on_a_hop_replaces_both_ends(wifi):
    session = Session(wifi)
    start_over(session)
    click_through(session)
    source = {"step": "receiveFrame", "port": "Interrupt", "item": "int"}
    target = {"step": "readFrame", "port": "eth_int", "item": "int"}
    hop(session, source, target, ("irq", "Irq"))
    receive_frame = session.action_def("ReceiveFrame")["parameters"]
    assert {"name": "irq", "direction": "out", "type": "Irq"} in receive_frame
    assert not [p for p in receive_frame if p["name"] == "int"]
    read_frame = session.action_def("ReadFrame")["parameters"]
    assert {"name": "irq", "direction": "in", "type": "Irq"} in read_frame
    assert succession("receiveFrame.irq", "readFrame.irq") in (
        session.action_def("ReadTemperature")["flows"]
    )


def test_a_hop_needs_a_wire_and_a_refusal_changes_nothing(wifi):
    session = Session(wifi)
    start_over(session)
    click_through(session)
    before = copy.deepcopy(session.docs)
    no_wire = session.refused(
        "set_hop",
        sheet=TOP,
        perform=PERFORM,
        source={"step": "receiveFrame", "port": "Interrupt"},
        target={"step": None, "port": "temp_read", "new": {"part": "temp_if"}},
        item={"name": "int", "type": "Int"},
    )
    assert no_wire == "bad_request"  # a new action needs its action def
    no_wire = session.refused(
        "set_hop",
        sheet=TOP,
        perform=PERFORM,
        source={"step": "receiveFrame", "port": "Interrupt"},
        target={"step": "returnTemp", "port": "temp_read"},
        item={"name": "int", "type": "Int"},
    )
    assert no_wire == "no_wire"
    bad_name = session.refused(
        "set_hop",
        sheet=TOP,
        perform=PERFORM,
        source={"step": "receiveFrame", "port": "Interrupt"},
        target={"step": "readFrame", "port": "eth_int"},
        item={"name": "not a name", "type": "Int"},
    )
    assert bad_name == "bad_name"
    assert session.docs == before
