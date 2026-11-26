"""`ha report resources`: each block's resources, rolled up, and the FPGA's
total against its target device. Exits 1 when the design does not fit."""

from __future__ import annotations

import argparse
import sys

from hdl_architect.core import config
from hdl_architect.core.model import ModelError
from hdl_architect.core.resources import (
    NOT_ESTIMATED,
    TO_BREAK_DOWN,
    BlockUse,
    ResourceReport,
    resource_report,
)

INDENT = "  "


def main(argv=None) -> int:
    args = parse_arguments(argv)
    try:
        paths, top = model_settings(args)
        report = resource_report(paths, top)
    except ModelError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print("\n".join(report_lines(report)))
    return exit_code(report)


def parse_arguments(argv) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="ha report resources",
        description="Each block's resource estimate, rolled up the hierarchy, and "
        "the FPGA's total against its target device. Settings from ha.toml "
        "([model] paths, top); options override it.",
    )
    parser.add_argument("--path", action="append", dest="paths", metavar="DIR")
    parser.add_argument("--top", help="the FPGA part def")
    parser.add_argument("--config", help="settings file (default: ha.toml)")
    return parser.parse_args(argv)


def model_settings(args) -> tuple[list[str], str]:
    settings, _ = config.load(args.config)
    model_settings = settings.get("model", {})
    paths = args.paths or model_settings.get("paths")
    top = args.top or model_settings.get("top")
    if not paths or not top:
        raise ModelError("need --path and --top (or [model] paths, top in ha.toml)")
    return paths, top


def exit_code(report: ResourceReport) -> int:
    if report.over_capacity() or report.over_budget() or report.problems:
        return 1
    return 0


# ---------------------------------------------------------------- the text


def report_lines(report: ResourceReport) -> list[str]:
    target = report.target
    table = Table(target.resource_names, report.top)
    lines = [f"Resources on {target.device} ({target.family})", ""]
    lines += table.header()
    lines += table.blocks(report.top)
    lines += table.footer(report)
    lines += problem_lines(report)
    return lines


class Table:
    """Columns: the block, then one per resource."""

    def __init__(self, resource_names: list[str], top: BlockUse):
        self.names = resource_names
        self.block_width = 2 + max(len(label) for label in labels(top))

    def row(self, label: str, cells: list[str]) -> str:
        columns = "".join(f"{cell:>10}" for cell in cells)
        return f"{label:<{self.block_width}}{columns}"

    def header(self) -> list[str]:
        return [self.row("block", self.names)]

    def blocks(self, block: BlockUse, depth: int = 0) -> list[str]:
        lines = [self.row(block_label(block, depth), self.used_cells(block))]
        for child in block.children:
            lines += self.blocks(child, depth + 1)
        return lines

    def used_cells(self, block: BlockUse) -> list[str]:
        if block.status in (NOT_ESTIMATED, TO_BREAK_DOWN):
            return ["-" for _ in self.names]
        return [str(block.used[name]) for name in self.names]

    def footer(self, report: ResourceReport) -> list[str]:
        target = report.target
        capacity = target.capacity
        used = report.top.used
        return [
            "",
            self.row("capacity", [str(capacity[name]) for name in self.names]),
            self.row("margin", [f"{target.margins[name]}%" for name in self.names]),
            self.row("budget", [str(target.budget(name)) for name in self.names]),
            self.row(
                "used", [percent(used[name], capacity[name]) for name in self.names]
            ),
        ]


def labels(block: BlockUse, depth: int = 0) -> list[str]:
    found = [block_label(block, depth)]
    for child in block.children:
        found += labels(child, depth + 1)
    return found


def block_label(block: BlockUse, depth: int) -> str:
    if depth == 0:
        return block.definition
    name = block.path.rsplit(".", 1)[-1]
    return f"{INDENT * depth}{name} : {block.definition}"


def percent(used: int, capacity: int) -> str:
    if capacity == 0:
        if used == 0:
            return "-"
        return "no room"
    return f"{round(100 * used / capacity)}%"


def problem_lines(report: ResourceReport) -> list[str]:
    lines = [""]
    for name in report.over_capacity():
        lines.append(f"warning: {name}: the design needs more than the device has")
    for name in report.over_budget():
        lines.append(f"warning: {name}: the design uses part of its margin")
    for problem in report.problems:
        lines.append(f"error: {problem}")
    missing = report.not_estimated()
    if missing:
        lines.append("not estimated (counted as 0): " + ", ".join(missing))
    unbroken = report.to_break_down()
    if unbroken:
        lines.append("to break down (no parts yet): " + ", ".join(unbroken))
    return lines
