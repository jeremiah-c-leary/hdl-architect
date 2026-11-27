"""Memory maps (decision 14, 2026-11-27): where each block's registers are, from
each root.

The model (examples/fpga_one shows the shape):

- A memory-mapped bus's port def specializes the abstract port def
  MemoryMappedManager (`port def AxiLite :> MemoryMappedManager`). Its
  manager ports carry addresses; its subordinate ports (conjugated, or a
  `conjugateOf` port def) are what is addressed.
- A memory map starts at a root: the manager port of what addresses the
  design (a processor, a PCIe bridge), marked with its map's name and the
  address it sees the map at:
  `port csr : AxiLite { attribute root : MemoryMapRoot { ... } }`.
  A design may have several roots.
- A crossbar says so: its part def specializes the abstract part def
  Crossbar as well as its kind (`part def AxiCrossbar1to2 :> VendorIp,
  Crossbar`; the kind says who owns its HDL, Crossbar what it does). Each
  wired manager port of a crossbar has an address window on its connection:
  `connect crossbar.m0 to csr.csr { attribute window : AddressWindow
  { :>> base = 0; :>> size = 4096; } }`. A window's base is an offset from
  the crossbar's own base, so a crossbar inside a subsystem is placed by
  the window above it (as SystemRDL's nested address maps are).
- Anything else reached is a leaf: its registers (its .rdl, the designer's)
  are in its window. A leaf with a manager port of its own (a DMA engine,
  say) has no windows on it: only a crossbar's manager ports do.

A subsystem is passed through: a window that reaches its port reaches what
that port is bound to inside it.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from hdl_architect.core.model import _JsonModel
from hdl_architect.core.resources import part_def, part_generals, unqualified

MANAGER = "MemoryMappedManager"
CROSSBAR_DEF = "Crossbar"
WINDOW = "AddressWindow"
ROOT = "MemoryMapRoot"

# What a block in a memory map is.
CROSSBAR = "crossbar"
REGISTERS = "registers"  # a leaf: its registers are in its window

# A port's role on a memory-mapped bus.
MANAGER_ROLE = "manager"
SUBORDINATE_ROLE = "subordinate"


@dataclass
class Block:
    """One block in a memory map, at its absolute address."""

    path: str  # FpgaOne.serial.regs
    definition: str
    base: int
    size: int | None  # None: reached with no window (straight from a root)
    role: str  # CROSSBAR or REGISTERS
    children: list[Block] = field(default_factory=list)


@dataclass
class MemoryMap:
    """What one root reaches."""

    name: str
    root: str  # the root's port: FpgaOne.ps.csr
    base: int
    top: Block | None  # None: its port is not wired to anything


@dataclass
class AddressReport:
    maps: list[MemoryMap]
    problems: list[str]  # the map is wrong: the report fails
    warnings: list[str]  # worth a look, e.g. a window not aligned to its size


@dataclass
class Place:
    """A part def where it is in the hierarchy: its parts' ends are refs
    there ("crossbar.m0"), its own ports' ends are bare ("csr")."""

    definition: dict
    path: str
    parent: Place | None = None
    part: str | None = None  # its part name in the parent


def address_report(search_path, top: str) -> AddressReport:
    """Every memory map of `top`, from each of its roots."""
    model = _JsonModel(search_path)
    report = AddressReport([], [], [])
    walk = MapWalk(model, report)
    top_place = Place(part_def(model, top), top)
    for root in walk.roots(top_place):
        report.maps.append(walk.memory_map(root))
    check_map_names(report)
    return report


def check_map_names(report: AddressReport) -> None:
    names = [memory_map.name for memory_map in report.maps]
    for name in sorted({name for name in names if names.count(name) > 1}):
        report.problems.append(f"two memory maps are named {name}")


# ---------------------------------------------------------------- the walk


@dataclass
class Root:
    """A root's port, where it is, and what its MemoryMapRoot says."""

    place: Place
    ref: str  # its end in `place`: "ps.csr", or "csr" for the place's own
    name: str
    base: int


@dataclass
class Hop:
    """Where a manager end leads over its wire: the subordinate end, and the
    window on the connection passed (None if there is none)."""

    place: Place
    ref: str
    window: dict | None


class MapWalk:
    """Follows each root's bus through the hierarchy."""

    def __init__(self, model: _JsonModel, report: AddressReport):
        self.model = model
        self.report = report

    # ------------------------------------------------------------ the roots

    def roots(self, top: Place) -> list[Root]:
        """The top's own root ports, then its parts' (and theirs), in order."""
        found = [
            self.root(top, port["name"], port)
            for port in top.definition.get("ports", [])
            if root_attribute(port)
        ]
        return found + self.part_roots(top)

    def part_roots(self, place: Place) -> list[Root]:
        found = []
        for part in place.definition.get("parts", []):
            definition = part_def(self.model, part["type"])
            for port in definition.get("ports", []):
                if root_attribute(port):
                    ref = f"{part['name']}.{port_id(port)}"
                    found.append(self.root(place, ref, port))
            found += self.part_roots(self.inside(place, part))
        return found

    def root(self, place: Place, ref: str, port: dict) -> Root:
        values = root_attribute(port).get("redefines", {})
        name = values.get("map_name") or end_path(place, ref)
        if port_role(self.model, port) != MANAGER_ROLE:
            self.report.problems.append(
                f"{end_path(place, ref)}: a memory map root must be the manager "
                f"port of a memory-mapped bus (a port def :> {MANAGER})"
            )
        return Root(place, ref, name, values.get("base", 0))

    def memory_map(self, root: Root) -> MemoryMap:
        path = end_path(root.place, root.ref)
        hop = self.hop(root.place, root.ref)
        if hop is None:
            self.report.problems.append(f"memory map {root.name}: {path} goes nowhere")
            return MemoryMap(root.name, path, root.base, None)
        size = window_size(hop.window)
        top = self.reached(hop, (root.base, size), set())
        return MemoryMap(root.name, path, root.base, top)

    # ------------------------------------------------------------ the wires

    def hop(self, place: Place, ref: str) -> Hop | None:
        """Where a manager end leads: over a connection, or through a
        binding into a part, or out to the part above."""
        for connection in place.definition.get("connections", []):
            if ref in connection["ends"]:
                far = other_end(connection, ref)
                return Hop(place, far, window_attribute(connection))
        for binding in place.definition.get("bindings", []):
            if ref in binding["ends"]:
                return self.through_binding(place, other_end(binding, ref))
        return None

    def through_binding(self, place: Place, far: str) -> Hop | None:
        """A part's port bound to this part def's own port: on, in the part
        above; else the binding leads into one of its parts."""
        if "." in far:
            return Hop(place, far, None)
        if place.parent is None:
            return None  # the top's own port: off the FPGA
        return self.hop(place.parent, f"{place.part}.{far}")

    # ------------------------------------------------------------ what is reached

    def reached(self, hop: Hop, window: tuple, seen: set) -> Block | None:
        """The block at a subordinate end, at (base, size): a subsystem's
        port leads inside it; a crossbar's windows lead on."""
        part_name, port_name = hop.ref.split(".", 1)
        part = find_part(hop.place.definition, part_name)
        place = self.inside(hop.place, part)
        key = (place.path, port_name)
        if key in seen:
            self.report.problems.append(f"{place.path}: the bus goes round in a loop")
            return None
        seen.add(key)  # on the way down: a loop comes back to it
        inner = bound_inside(place.definition, port_name)
        if inner is not None:
            found = self.reached(Hop(place, inner, hop.window), window, seen)
        else:
            found = self.block(place, port_name, (window, seen))
        seen.discard(key)  # reached again by another way is not a loop
        return found

    def block(self, place: Place, way_in: str, where: tuple) -> Block:
        (base, size), seen = where
        definition = place.definition["name"]
        hops = self.manager_hops(place, way_in)
        if CROSSBAR_DEF not in part_generals(self.model, definition):
            self.refuse_windows(place, hops)
            return Block(place.path, definition, base, size, REGISTERS)
        crossbar = Block(place.path, definition, base, size, CROSSBAR)
        for manager, hop in hops:
            child = self.windowed(crossbar, (manager, hop), seen)
            if child is not None:
                crossbar.children.append(child)
        check_windows(crossbar, self.report)
        return crossbar

    def manager_hops(self, place: Place, way_in: str) -> list[tuple[str, Hop]]:
        """The part's manager ports (not the way in, nor roots), and where
        each leads."""
        hops = []
        for port in place.definition.get("ports", []):
            name = port_id(port)
            if name == way_in or root_attribute(port):
                continue
            if port_role(self.model, port) != MANAGER_ROLE:
                continue
            hop = self.hop(place.parent, f"{place.part}.{name}")
            if hop is not None:
                hops.append((name, hop))
        return hops

    def refuse_windows(self, place: Place, hops: list[tuple[str, Hop]]) -> None:
        """A window from a part that is not a crossbar: it says nothing."""
        for manager, hop in hops:
            if hop.window is not None:
                self.report.problems.append(
                    f"{place.path}.{manager}: has an address window, but "
                    f"{place.definition['name']} is not a crossbar (a part def "
                    f":> {CROSSBAR_DEF})"
                )

    def windowed(self, crossbar: Block, wire: tuple, seen: set) -> Block | None:
        manager, hop = wire
        if hop.window is None:
            self.report.problems.append(
                f"{crossbar.path}.{manager}: no address window (every wired "
                "manager port of a crossbar needs one)"
            )
            return None
        values = hop.window.get("redefines", {})
        base = crossbar.base + values.get("base", 0)
        return self.reached(hop, (base, values.get("size")), seen)

    def inside(self, place: Place, part: dict) -> Place:
        definition = part_def(self.model, part["type"])
        path = f"{place.path}.{part['name']}"
        return Place(definition, path, place, part["name"])


# ---------------------------------------------------------------- the checks


def check_windows(crossbar: Block, report: AddressReport) -> None:
    """A crossbar's windows: within its own, not overlapping, aligned."""
    placed = [child for child in crossbar.children if child.size is not None]
    for child in placed:
        check_inside(crossbar, child, report)
        check_aligned(crossbar, child, report)
    by_base = sorted(placed, key=lambda child: child.base)
    for first, second in zip(by_base, by_base[1:]):
        if first.base + first.size > second.base:
            report.problems.append(
                f"{crossbar.path}: the windows of {first.path} and {second.path} "
                f"overlap ({span_text(first)} and {span_text(second)})"
            )


def check_inside(crossbar: Block, child: Block, report: AddressReport) -> None:
    if crossbar.size is None:
        return
    if child.base + child.size > crossbar.base + crossbar.size:
        report.problems.append(
            f"{child.path}: its window ({span_text(child)}) ends outside "
            f"{crossbar.path}'s own ({span_text(crossbar)})"
        )


def check_aligned(crossbar: Block, child: Block, report: AddressReport) -> None:
    """Many crossbars decode only a base that is a multiple of the size."""
    offset = child.base - crossbar.base
    if child.size and offset % child.size:
        report.warnings.append(
            f"{child.path}: its window's base ({address_text(child.base)}) is "
            f"not a multiple of its size ({size_text(child.size)})"
        )


# ---------------------------------------------------------------- the model


def port_role(model: _JsonModel, port: dict) -> str | None:
    """MANAGER_ROLE or SUBORDINATE_ROLE on a memory-mapped bus; None if the
    port is not on one."""
    if "type" not in port:
        return None
    name = unqualified(port["type"])
    conjugated = bool(port.get("conjugated"))
    definition = port_def(model, name)
    if definition is not None and "conjugateOf" in definition:
        name = unqualified(definition["conjugateOf"])
        conjugated = not conjugated
    if MANAGER not in port_generals(model, name):
        return None
    return SUBORDINATE_ROLE if conjugated else MANAGER_ROLE


def port_def(model: _JsonModel, name: str) -> dict | None:
    entry = model.defs.get(name)
    if entry is None or entry[0] != "portDefs":
        return None
    return entry[1]


def port_generals(model: _JsonModel, name: str) -> set[str]:
    """A port def and every port def it specializes, directly or not."""
    found: set[str] = set()
    pending = [name]
    while pending:
        current = pending.pop()
        definition = port_def(model, current)
        if current in found or definition is None:
            continue
        found.add(current)
        pending += [unqualified(n) for n in definition.get("specializes", [])]
    return found


def root_attribute(port: dict) -> dict | None:
    return typed_attribute(port, ROOT)


def window_attribute(connection: dict) -> dict | None:
    return typed_attribute(connection, WINDOW)


def typed_attribute(element: dict, type_name: str) -> dict | None:
    for attribute in element.get("attributes", []):
        if unqualified(attribute["type"]) == type_name:
            return attribute
    return None


def window_size(window: dict | None) -> int | None:
    if window is None:
        return None
    return window.get("redefines", {}).get("size")


def port_id(port: dict) -> str:
    """The identifier a port is referred to by (its shortName, if it has one)."""
    return port.get("shortName", port["name"])


def find_part(definition: dict, name: str) -> dict:
    for part in definition.get("parts", []):
        if part["name"] == name:
            return part
    raise KeyError(f"{definition['name']} has no part {name}")


def bound_inside(definition: dict, port_name: str) -> str | None:
    """The end inside a part def that its own port is bound to, if any."""
    for binding in definition.get("bindings", []):
        if port_name in binding["ends"]:
            far = other_end(binding, port_name)
            if "." in far:
                return far
    return None


def other_end(wire: dict, ref: str) -> str:
    first, second = wire["ends"]
    return second if first == ref else first


def end_path(place: Place, ref: str) -> str:
    return f"{place.path}.{ref}"


# ---------------------------------------------------------------- the text


def address_text(address: int) -> str:
    """0x4000_1000: hex, at least 8 digits, in groups of 4."""
    digits = f"{address:08X}"
    groups = []
    while digits:
        groups.insert(0, digits[-4:])
        digits = digits[:-4]
    return "0x" + "_".join(groups)


def size_text(size: int) -> str:
    """4 KiB, 1 MiB, ...; bytes if it is not a whole number of KiB."""
    for unit, scale in (("GiB", 1 << 30), ("MiB", 1 << 20), ("KiB", 1 << 10)):
        if size >= scale and size % scale == 0:
            return f"{size // scale} {unit}"
    return f"{size} B"


def span_text(block: Block) -> str:
    end = block.base + block.size - 1
    return f"{address_text(block.base)}..{address_text(end)}"
