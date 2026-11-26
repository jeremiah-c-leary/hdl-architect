"""`ha report actions`: every action the FPGA performs, step by step: which
part performs each step, which port each item enters and leaves by, and the
step's status (performed, decomposed, to break down). Problems (a missing
wire, a port not said, a step its part does not perform) are errors: exit 1."""

from __future__ import annotations

import argparse
import sys

from hdl_architect.core.actions import ActionReport, ItemPort, Step, action_report
from hdl_architect.core.model import ModelError
from hdl_architect.reports.resources import model_settings

INDENT = "  "


def main(argv=None) -> int:
    args = parse_arguments(argv)
    try:
        paths, top = model_settings(args)
        report = action_report(paths, top)
    except ModelError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print("\n".join(report_lines(report)))
    return exit_code(report)


def parse_arguments(argv) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="ha report actions",
        description="The actions the FPGA performs, step by step. Settings from "
        "ha.toml ([model] paths, top); options override it.",
    )
    parser.add_argument("--path", action="append", dest="paths", metavar="DIR")
    parser.add_argument("--top", help="the FPGA part def")
    parser.add_argument("--config", help="settings file (default: ha.toml)")
    return parser.parse_args(argv)


def exit_code(report: ActionReport) -> int:
    if report.problems:
        return 1
    return 0


def report_lines(report: ActionReport) -> list[str]:
    lines = []
    for action in report.actions:
        lines.append(f"{action.owner} performs {action.name} : {action.action_def}")
        lines += item_lines(action.items, INDENT)
        lines += step_lines(action.steps, INDENT)
        lines.append("")
    if not report.actions:
        lines.append("(no performed actions)")
    lines += [f"error: {problem}" for problem in report.problems]
    return lines


def step_lines(steps: list[Step], indent: str) -> list[str]:
    lines = []
    for number, step in enumerate(steps, start=1):
        lines.append(f"{indent}{number}. {step_heading(step)}")
        lines += item_lines(step.items, indent + INDENT + " ")
        lines += step_lines(step.steps, indent + INDENT + " ")
    return lines


def step_heading(step: Step) -> str:
    """ "readSensor : ReadSensor, by temp_if : TempSensorInterface (performed)"."""
    who = "no part"
    if step.part:
        who = f"{step.part} : {step.part_def}"
    return f"{step.name} : {step.action_def}, by {who} ({step.status})"


def item_lines(items: list[ItemPort], indent: str) -> list[str]:
    return [f"{indent}{item_text(item)}" for item in items]


def item_text(item: ItemPort) -> str:
    """ "gets request : TemperatureRequest via temp_read"."""
    verb = "gets" if item.direction == "in" else "gives"
    via = f"via {item.port}.{item.port_item}" if item.port else "(port not said)"
    return f"{verb} {item.item} : {item.item_type} {via}"
