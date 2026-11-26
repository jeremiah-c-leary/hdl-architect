"""`ha report devices`: the design against every device of its target's
family, smallest first: each resource's share of the device, and whether the
design fits within its margins. Uses the FPGA's own margins for every device."""

from __future__ import annotations

import argparse
import sys

from hdl_architect.core.model import ModelError
from hdl_architect.core.resources import (
    IN_MARGIN,
    PAST_DEVICE,
    DeviceFit,
    ResourceReport,
    device_fits,
    smallest_fit,
)
from hdl_architect.reports.resources import model_settings

MARKS = {IN_MARGIN: "~", PAST_DEVICE: "!"}


def main(argv=None) -> int:
    args = parse_arguments(argv)
    try:
        paths, top = model_settings(args)
        report, fits = device_fits(paths, top)
    except ModelError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print("\n".join(report_lines(report, fits)))
    return 0


def parse_arguments(argv) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="ha report devices",
        description="The design against every device of its target's family. "
        "Settings from ha.toml ([model] paths, top); options override it.",
    )
    parser.add_argument("--path", action="append", dest="paths", metavar="DIR")
    parser.add_argument("--top", help="the FPGA part def")
    parser.add_argument("--config", help="settings file (default: ha.toml)")
    return parser.parse_args(argv)


def report_lines(report: ResourceReport, fits: list[DeviceFit]) -> list[str]:
    names = report.target.resource_names
    lines = [f"Device fit ({report.target.family}), smallest first", ""]
    lines.append(row("device", names, "fit"))
    lines += [device_row(report, fit) for fit in fits]
    lines += legend_lines(report, fits)
    return lines


def device_row(report: ResourceReport, fit: DeviceFit) -> str:
    cells = [share_cell(report, fit, name) for name in report.target.resource_names]
    label = fit.device
    if fit.device == report.target.device:
        label += " (target)"
    return row(label, cells, fit.verdict())


def share_cell(report: ResourceReport, fit: DeviceFit, name: str) -> str:
    """The design's share of one resource: "31%", "~74%" in the margin, "!" past."""
    used = report.top.used[name]
    capacity = fit.capacity[name]
    if capacity == 0:
        return no_capacity_text(used)
    mark = MARKS.get(fit.levels[name], "")
    return f"{mark}{round(100 * used / capacity)}%"


def no_capacity_text(used: int) -> str:
    if used == 0:
        return "-"
    return "!none"


def row(label: str, cells: list[str], verdict: str) -> str:
    columns = "".join(f"{cell:>10}" for cell in cells)
    return f"{label:<20}{columns}   {verdict}"


def legend_lines(report: ResourceReport, fits: list[DeviceFit]) -> list[str]:
    lines = ["", "~ in the margin; ! past the device"]
    smallest = smallest_fit(fits)
    if smallest:
        lines.append(f"smallest that fits: {smallest}")
    missing = report.to_break_down() + report.not_estimated()
    if missing:
        lines.append(f"incomplete: {len(missing)} blocks to break down or estimate")
    return lines
