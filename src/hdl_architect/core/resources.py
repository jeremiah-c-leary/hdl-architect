"""Resource estimates: each block's estimate, rolled up the hierarchy, and the
FPGA's total against its target device's capacity.

The model (examples/wifi_router/fpga_devices.json shows the shape):

- A device family's resources are an attribute def specializing
  FpgaResources: `attribute def ZynqUltraScalePlusResources :> FpgaResources`
  with one attribute per resource (lut, ff, ...).
- A device is an attribute def specializing FpgaDevice, with an attribute
  typed by its family's resources (its capacity) and values for it.
- The FPGA part def names its target device: `attribute device : XCZU9EG;`.
- A block's estimate is an attribute typed by the family's resources:
  `attribute zynqUltraScalePlusEstimate : ZynqUltraScalePlusResources {...}`.

Roll-up blocks (with parts, or of a roll-up kind: Subsystem, FpgaPart, ...)
are the sum of their parts and may not have an estimate of their own: a
subsystem is broken down, never estimated. Leaves (Rtl, VendorIp, ...) carry
the estimates; a leaf without one is "not estimated" (counted as zero, and
listed), and a roll-up block without parts is "to break down".
"""

from __future__ import annotations

from dataclasses import dataclass, field

from hdl_architect.core.model import ModelError, _JsonModel

DEVICE_ROOT = "FpgaDevice"
RESOURCES_ROOT = "FpgaResources"
ROLL_UP_KINDS = {"SystemPart", "FpgaPart", "Fpga", "Subsystem", "Container"}

# How a block's resources are known.
ESTIMATED = "estimated"  # a leaf with an estimate
NOT_ESTIMATED = "not estimated"  # a leaf without one
SUM_OF_PARTS = "sum of parts"  # a roll-up block with parts
TO_BREAK_DOWN = "to break down"  # a roll-up block without parts yet


@dataclass
class BlockUse:
    """One block in the hierarchy and the resources it uses."""

    path: str
    definition: str
    used: dict[str, int]
    status: str  # ESTIMATED, NOT_ESTIMATED, SUM_OF_PARTS or TO_BREAK_DOWN
    children: list[BlockUse] = field(default_factory=list)


@dataclass
class Target:
    """The FPGA's target device, its family's resources, and its capacity."""

    device: str
    family: str  # the family's resources def
    resource_names: list[str]
    capacity: dict[str, int]


@dataclass
class ResourceReport:
    target: Target
    top: BlockUse
    problems: list[str]  # model errors: an estimate on a roll-up block

    def not_estimated(self) -> list[str]:
        return self.paths_with_status(NOT_ESTIMATED)

    def to_break_down(self) -> list[str]:
        return self.paths_with_status(TO_BREAK_DOWN)

    def paths_with_status(self, status: str) -> list[str]:
        return [block.path for block in leaves(self.top) if block.status == status]

    def over_capacity(self) -> list[str]:
        """The resources the FPGA needs more of than its device has."""
        return [
            name
            for name in self.target.resource_names
            if self.top.used[name] > self.target.capacity[name]
        ]


def leaves(block: BlockUse) -> list[BlockUse]:
    if not block.children:
        return [block]
    return [leaf for child in block.children for leaf in leaves(child)]


def resource_report(search_path, top: str) -> ResourceReport:
    """Roll the estimates up from the leaves of `top` and find its target."""
    model = _JsonModel(search_path)
    top_definition = part_def(model, top)
    target = target_of(model, top_definition)
    problems: list[str] = []
    walk = HierarchyWalk(model, target, problems)
    top_use = walk.block(top_definition, path=top)
    return ResourceReport(target, top_use, problems)


# ---------------------------------------------------------------- the target device


def target_of(model: _JsonModel, fpga: dict) -> Target:
    device = device_attribute(model, fpga)
    capacity_attribute = family_attribute(model, device)
    family = unqualified(capacity_attribute["type"])
    names = resource_names(model, family)
    capacity = inherited_values(model, device).get(capacity_attribute["name"], {})
    return Target(
        device=device,
        family=family,
        resource_names=names,
        capacity=with_zeros(capacity, names),
    )


def device_attribute(model: _JsonModel, fpga: dict) -> str:
    """The name of the device the FPGA part def targets."""
    for attribute in fpga.get("attributes", []):
        type_name = unqualified(attribute["type"])
        if specializes(model, type_name, DEVICE_ROOT):
            return type_name
    raise ModelError(
        f"{fpga['name']} has no target device: add `attribute device : <device>` "
        f"(a device is an attribute def specializing {DEVICE_ROOT})"
    )


def family_attribute(model: _JsonModel, device: str) -> dict:
    """The device's attribute typed by its family's resources: its capacity."""
    for attribute in inherited_attributes(model, device):
        if specializes(model, unqualified(attribute["type"]), RESOURCES_ROOT):
            return attribute
    raise ModelError(
        f"device {device} has no capacity: an attribute typed by a "
        f"{RESOURCES_ROOT} specialization"
    )


def resource_names(model: _JsonModel, family: str) -> list[str]:
    return [attribute["name"] for attribute in inherited_attributes(model, family)]


# ---------------------------------------------------------------- the roll-up


class HierarchyWalk:
    """Walks the part hierarchy, summing each block's resources."""

    def __init__(self, model: _JsonModel, target: Target, problems: list[str]):
        self.model = model
        self.target = target
        self.problems = problems

    def block(self, definition: dict, path: str) -> BlockUse:
        if self.is_roll_up(definition):
            return self.roll_up(definition, path)
        return self.leaf(definition, path)

    def is_roll_up(self, definition: dict) -> bool:
        if concrete_parts(definition):
            return True
        return bool(ROLL_UP_KINDS & part_generals(self.model, definition["name"]))

    def roll_up(self, definition: dict, path: str) -> BlockUse:
        self.refuse_own_estimate(definition, path)
        parts = concrete_parts(definition)
        children = [self.part(part, path) for part in parts]
        used = self.zeros()
        for child, part in zip(children, parts):
            add_into(used, child.used, part_count(part))
        status = SUM_OF_PARTS if parts else TO_BREAK_DOWN
        return BlockUse(path, definition["name"], used, status, children)

    def refuse_own_estimate(self, definition: dict, path: str) -> None:
        if self.estimate_of(definition) is None:
            return
        self.problems.append(
            f"{path} ({definition['name']}) may not have an estimate: it is a "
            "roll-up block, the sum of its parts. Break it down, and estimate "
            "the parts."
        )

    def part(self, part: dict, parent_path: str) -> BlockUse:
        definition = part_def(self.model, part["type"])
        return self.block(definition, path=f"{parent_path}.{part['name']}")

    def leaf(self, definition: dict, path: str) -> BlockUse:
        estimate = self.estimate_of(definition)
        if estimate is None:
            return BlockUse(path, definition["name"], self.zeros(), NOT_ESTIMATED)
        used = with_zeros(estimate, self.target.resource_names)
        return BlockUse(path, definition["name"], used, ESTIMATED)

    def estimate_of(self, definition: dict) -> dict | None:
        """The block's estimate in the target's family, or None."""
        for attribute in definition.get("attributes", []):
            if unqualified(attribute["type"]) == self.target.family:
                return attribute.get("redefines", {})
        return None

    def zeros(self) -> dict[str, int]:
        return with_zeros({}, self.target.resource_names)


def concrete_parts(definition: dict) -> list[dict]:
    return [part for part in definition.get("parts", []) if not part.get("isAbstract")]


def part_count(part: dict) -> int:
    multiplicity = part.get("multiplicity")
    if isinstance(multiplicity, int):
        return multiplicity
    return 1


def add_into(total: dict[str, int], used: dict[str, int], count: int) -> None:
    for name in total:
        total[name] += used[name] * count


def with_zeros(values: dict, names: list[str]) -> dict[str, int]:
    return {name: values.get(name, 0) for name in names}


# ---------------------------------------------------------------- model lookups


def part_def(model: _JsonModel, name: str) -> dict:
    definition, _ = model.get(unqualified(name), "partDefs", name)
    return definition


def part_generals(model: _JsonModel, name: str) -> set[str]:
    """A part def and every part def it specializes, directly or not."""
    found: set[str] = set()
    pending = [unqualified(name)]
    while pending:
        current = pending.pop()
        entry = model.defs.get(current)
        if current in found or entry is None or entry[0] != "partDefs":
            continue
        found.add(current)
        pending += [unqualified(n) for n in entry[1].get("specializes", [])]
    return found


def attribute_def(model: _JsonModel, name: str) -> dict | None:
    entry = model.defs.get(name)
    if entry is None or entry[0] != "attributeDefs":
        return None
    return entry[1]


def generals(model: _JsonModel, name: str) -> list[str]:
    """An attribute def and every def it specializes, nearest first."""
    chain: list[str] = []
    pending = [name]
    while pending:
        current = pending.pop(0)
        definition = attribute_def(model, current)
        if current in chain or definition is None:
            continue
        chain.append(current)
        pending += [unqualified(n) for n in definition.get("specializes", [])]
    return chain


def specializes(model: _JsonModel, name: str, general: str) -> bool:
    return general in generals(model, name)


def inherited_attributes(model: _JsonModel, name: str) -> list[dict]:
    """The attributes of an attribute def and of the defs it specializes."""
    found = []
    for definition_name in reversed(generals(model, name)):
        found += attribute_def(model, definition_name).get("attributes", [])
    return found


def inherited_values(model: _JsonModel, name: str) -> dict:
    """The values an attribute def and its generals give; the nearest wins."""
    values: dict = {}
    for definition_name in reversed(generals(model, name)):
        values.update(attribute_def(model, definition_name).get("redefines", {}))
    return values


def unqualified(name: str) -> str:
    return name.split("::")[-1]


# ---------------------------------------------------------------- for HA 2


def report_as_dict(report: ResourceReport) -> dict:
    """The report as JSON for HA 2: the target, and each part def's totals (the
    same wherever the def is used)."""
    target = report.target
    return {
        "device": target.device,
        "family": target.family,
        "resourceNames": target.resource_names,
        "capacity": target.capacity,
        "top": report.top.definition,
        "definitions": totals_by_definition(report.top),
        "problems": report.problems,
    }


def totals_by_definition(block: BlockUse) -> dict:
    totals = {block.definition: {"used": block.used, "status": block.status}}
    for child in block.children:
        totals.update(totals_by_definition(child))
    return totals
