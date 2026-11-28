"""`ha report addresses`: each memory map, from its root, with every block's
absolute address (decision 14). Exits 1 when a map is wrong (overlapping
windows, a crossbar port with no window, ...)."""

from __future__ import annotations

import argparse
import sys

from hdl_architect.core.addresses import (
    CROSSBAR,
    AddressReport,
    Block,
    MemoryMap,
    address_report,
    address_text,
    size_text,
)
from hdl_architect.core.model import ModelError
from hdl_architect.reports.resources import model_settings

INDENT = "  "


def main(argv=None) -> int:
    args = parse_arguments(argv)
    try:
        paths, top = model_settings(args)
        report = address_report(paths, top)
    except ModelError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print("\n".join(report_lines(report, top)))
    return 1 if report.problems else 0


def parse_arguments(argv) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="ha report addresses",
        description="Each memory map, from its root: every block's absolute "
        "address. Settings from ha.toml ([model] paths, top); options override "
        "it.",
    )
    parser.add_argument("--path", action="append", dest="paths", metavar="DIR")
    parser.add_argument("--top", help="the FPGA part def")
    parser.add_argument("--config", help="settings file (default: ha.toml)")
    return parser.parse_args(argv)


# ---------------------------------------------------------------- the text


def report_lines(report: AddressReport, top: str) -> list[str]:
    if not report.maps:
        return [
            f"{top} has no memory map: no port is marked as a root "
            "(attribute root : MemoryMapRoot)."
        ] + note_lines(report)
    lines = []
    for memory_map in report.maps:
        lines += map_lines(memory_map) + [""]
    return lines + note_lines(report)


def map_lines(memory_map: MemoryMap) -> list[str]:
    head = (
        f"Memory map {memory_map.name}: from {memory_map.root}, "
        f"at {address_text(memory_map.base)}"
    )
    if memory_map.top is None:
        return [head, f"{INDENT}(nothing reached)"]
    return [head] + block_lines(memory_map.top, depth=1)


def block_lines(block: Block, depth: int) -> list[str]:
    lines = [INDENT * depth + block_text(block)]
    for child in block.children:
        lines += block_lines(child, depth + 1)
    return lines


def block_text(block: Block) -> str:
    """0x4000_1000..0x4000_1FFF  4 KiB  FpgaOne.serial.regs (SerialCsr)"""
    kind = " crossbar" if block.role == CROSSBAR else ""
    name = f"{block.path} ({block.definition}{kind})"
    if not block.window_set:
        return f"(window not set)  {name}"
    if block.size is None:
        return f"{address_text(block.base)}  (no window)  {name}"
    end = address_text(block.base + block.size - 1)
    return f"{address_text(block.base)}..{end}  {size_text(block.size)}  {name}"


def note_lines(report: AddressReport) -> list[str]:
    lines = [f"problem: {problem}" for problem in report.problems]
    return lines + [f"warning: {warning}" for warning in report.warnings]
