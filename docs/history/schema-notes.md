# SysML-shaped JSON (spike10, started 2026-11-22)

> Historical note, copied from `sysmlpy_spike` at the move (2026-11-25). Paths
> refer to that repository; the maintained code is in `src/hdl_architect/`.

The model's data in JSON, following SysML v2: one JSON object is one SysML
element, and relationship objects (memberships, typings, specializations) are
folded into fields. Rule: **no concept that SysML does not have.** A need that
SysML can't express becomes a SysML `metadata def`, not a new JSON field.

Why not the OMG standard JSON (`SysML.json` in the Systems Modeling API)? It
is an interchange format: `part def Uart :> Subsystem { doc ... }` is 4
objects and 7 KB there (measured from SysON's REST API), mostly derived
fields and UUID links. Not readable, not diffable, and writing it correctly
needs the language's semantics.

| File | Role |
|---|---|
| `../../layered/schema/sysml-json.schema.json` | The schema (JSON Schema 2020-12), version 0.4 (moved there at the switch, 2026-11-22) |
| `../model-json/*.json` | Model data (hand-written for now; later written by the view tool) |
| `../../layered/gen_sysml.py` | Generator: JSON -> SysML text (validates first); was `spike10/tools/json_to_sysml.py` |
| `../tools/compare_defs.py` | Migration check (done): definitions in two sets of .sysml files, via sysmlpy |
| `../tools/sysml_to_json_once.py` | One-off migration of our existing .sysml files (a subset reader, not a parser) |

## Version 0.1: packages, attribute defs, port defs

| JSON | SysML |
|---|---|
| `package {name, doc, imports}` | `package Name { doc /* */ private import X::*; }` |
| `attributeDefs[] {name, doc, attributes}` | `attribute def Name { ... }` |
| `portDefs[] {name, doc, attributes}` | `port def Name { ... }` |
| `attributes[] {name, type}` | `attribute name : Type;` (a parameter) |
| `... direction: in/out/inout` | `in attribute name : Type;` (a directed feature: a signal) |
| `... default: v` | `attribute name : Type default v;` |
| `... redefines: {width: 4}` | `attribute name : LogicVector { attribute :>> width = 4; }` |
| `{expr: "lanes"}` | an expression (`lanes`), as opposed to a string literal |
| `portDefs[] {name, doc, conjugateOf: X}` | SysML conjugation, written out: X's features with in/out swapped |

`conjugateOf` keeps both roles of an interface in one place (as HA's
protocols do) while the text keeps the convention of explicit role pairs
(no `~`).

Names must be legal VHDL identifiers too (`^[A-Za-z](_?[A-Za-z0-9])*$`).

## Check (2026-11-22)

`model-json/port_defs.json` was written from
`spike8/part-library/lib/port_defs.sysml`. Generating SysML from it and
comparing with the original: 27 definitions, 0 differences (direction, type,
default and redefinitions of every attribute). The output is byte-identical
across runs. A changed direction in a base port def shows up in its
conjugate; invalid input (a name with a space, both `attributes` and
`conjugateOf`, an unknown `conjugateOf`) is rejected with exit 1.

## Version 0.2: part defs and metadata defs (2026-11-22)

| JSON | SysML |
|---|---|
| `package.comments[]`, `partDef.comments[]` | `comment /* */` (a model element; `//` notes have no JSON form) |
| `metadataDefs[] {name, doc, attributes}` | `metadata def Name { attribute ...; }` |
| `partDefs[] {name, doc, isAbstract, specializes}` | `abstract part def Name :> A, B { ... }` |
| `metadata[] {type, values}` | `@Datasheet { manufacturer = "..."; ... }` |
| `parts[] {name, type, multiplicity, doc, redefines}` | `part name : Type[n] { doc; attribute :>> k = v; }` |
| `ports[] {name, type, doc, redefines}` | `port name : PortDef { doc; attribute :>> lanes = 8; }` |
| `bindings[] {ends: [a, b]}` | `bind a = b;` |
| `connections[] {ends: [a, b]}` | `connect a to b;` |
| `performs[] {name, type}` | `perform action name : ActionDef;` |
| `allocations[] {from, to}` | `allocate from to to;` |

Converted with `sysml_to_json_once.py`: PartKinds, PartMetadata, the four HW
parts (AD9172, AD9208, HMC7044, TMP117), WifiPacketRouterSubsystems and
WifiPacketRouterFpgaSys. `//` comments were dropped by the converter; the ones
that matter (OPEN items, "not modelled", the HMC7044 channel pairing) were
added back by hand as `comments`; section headers were not.

Check: the original files against the generated ones (with the behaviour and
interfaces files, not yet converted, on both sides): 47 definitions, 0
differences. `gen_views.py` gives byte-identical PlantUML from the generated
SysML. Generation is deterministic. A removed bind, a changed port value and a
changed metadata value are each reported.

## Version 0.3: items and actions (2026-11-22)

| JSON | SysML |
|---|---|
| `itemDefs[] {name, doc, attributes}` | `item def Name { ... }` |
| `portDefs[].items[] {name, direction, type, doc}` | `out item cmd : Command;` in a port def (what it carries) |
| `conjugateOf` | now swaps items as well as attributes |
| `actionDefs[] {name, doc, comments}` | `action def Name { ... }` |
| `... parameters[]` (items) | `in item cmdFrame : EthFrame;` |
| `... actions[] {name, type, doc, parameters}` | `action step { in item ...; }` or `action step : Def;` |
| `... bindings[] {ends}` | `bind receiveFrame.ethFrame = cmdFrame;` |
| `... flows[] {from, to, succession}` | `succession flow from a.x to b.y;` (`flow` without succession) |

Converted: WifiPacketRouterBehavior and WifiPacketRouterInterfaces. The
converter turns a port def that mirrors an earlier one into `conjugateOf`
(CommandTarget, TempReadTarget). The `//` notes on the interfaces became
their port defs' docs.

The whole spike10 model is now JSON (11 files). Check: the original .sysml
files against the SysML generated from JSON alone: 53 definitions, 0
differences; `gen_views.py` run on the generated SysML only gives
byte-identical PlantUML; generation is deterministic. A dropped flow, a flow
that lost `succession`, a flipped step parameter and a changed item type
(which also shows in the conjugate) are each reported.

## SysON check (2026-11-22)

The 11 generated files were inserted into a new SysON v2026.11 project,
`spike10-json` (one root package `GeneratedFromJson`), through SysON's
`insertTextualSysMLv2` mutation: all accepted. Read back with AQL and the REST
API:

- Counts match the JSON: 15 part defs, 28 port defs (SysON adds a conjugate
  for each: 56), 5 item defs, 1 action def, 1 metadata def, 73 ports, 6 parts,
  15 binds, 2 connects, 5 allocations, 4 succession flows, 1 perform, 4
  metadata usages, 126 docs, 6 comments, 11 specializations; attributes 128 =
  128, by name.
- Everything resolved: no untyped port, part or item; no unresolved
  specialization, redefinition, import (22), metadata def or perform; all 52
  connector ends present, the 24 chained ones (`readTemperature.receiveFrame`)
  fully resolved.
- Values survived: e.g. `sys_clock` frequency 100000000.0 and duty cycle 0.5;
  the AD9172's @Datasheet values.

So the generated text is SysML that a second, independent implementation
accepts and resolves in full.

## Version 0.4: what layered/ uses (2026-11-22)

| JSON | SysML |
|---|---|
| `ports[].conjugated: true` | `port csr : ~AxiLite;` |
| `parts[] {isAbstract, multiplicity: "0..*", subsets: [children]}` | `abstract part children : FpgaComponent[0..*];`, `part regs : SerialCsr :> children;` |
| `partDefs[].attributes[]` | `attribute baud : Integer default 115200;` (generics, parameters) |
| `partDefs[].redefines` | `attribute :>> lut = 500;` (values for inherited attributes; may be an expression) |
| `partDefs[].constraints[] {name, assert, expr}` | `assert constraint lutMargin { ... }` |
| `attributes[].multiplicity` | `attribute files : String[1..*];` |
| a list value `["a", "b"]` | `("a", "b")` |

Converted: `layered/` FpgaLib, the five IPs, the serial subsystem and
FpgaOne (8 JSON files next to their .sysml, so `@HdlSource` paths stay
relative to the same directory).

Check: a copy of `layered/` with every .sysml replaced by the one generated
from its JSON, run through the unchanged pipeline (`fpga_ir.py` with
sysmlpy, `gen_vhdl.py`, `gen_questa_compile.py`): `serial_subsystem.vhd`,
`fpga_one.vhd` and `compile.do` are byte-identical to the originals' output;
the IR (`ir.json`) is identical apart from the directory name; the warnings
are the same.

## JSON front end in layered/fpga_ir.py (2026-11-22)

`load_ir(paths, top, source="json")`, or `--source json` on `fpga_ir.py`,
`gen_vhdl.py` and `gen_questa_compile.py` (default: `sysml`). No parser: the
files are validated against this schema, names are resolved through each
package's imports, and the same elaboration rules build the IR. FpgaOne from
JSON: the IR equals the sysmlpy IR except `source_file`; `compile.do` is
byte-identical; the VHDL differs only in its header line ("generated ... from
fpga_one.json"); Questa compiles it with 0 errors.

## Version 0.7: devices and resource estimates (2026-11-25)

Attribute defs may now be abstract, specialize other attribute defs and give
values (`redefines`), and values may nest: `{"capacity": {"lut": 274080}}` is
`attribute :>> capacity { attribute :>> lut = 274080; }`. The shape, in
`examples/wifi_router/fpga_devices.json`:

| JSON | SysML |
|---|---|
| `attributeDefs[] {name: ZynqUltraScalePlusResources, specializes: [FpgaResources], attributes: [lut, ...]}` | a device family's resources: what blocks estimate |
| `attributeDefs[] {name: XCZU9EG, specializes: [ZynqUltraScalePlusDevice], redefines: {capacity: {lut: 274080, ...}}}` | a device and its capacity |
| part def `attributes[] {name: device, type: XCZU9EG}` | the FPGA's target device |
| part def `attributes[] {name: zynqUltraScalePlusEstimate, type: ZynqUltraScalePlusResources, redefines: {lut: 120}}` | a block's estimate |

Only attributes of a scalar type (Integer, Natural, Positive, Real, Boolean,
String) become VHDL generics; a device or an estimate is model data only.

SysON check: the 12 files generated from the Wi-Fi example were inserted into
a new SysON v2026.11 project (`resource-estimates-check-2`): all accepted, no
messages (a first try warned that `FpgaDevices` used `Integer` without
importing `ScalarValues`: fixed in the JSON). Read back with AQL: all 30
redefinitions of the new attributes resolve to the right element (29 to the
same-named attribute of `ZynqUltraScalePlusResources`, `capacity` to
`ZynqUltraScalePlusDevice`'s); `device` is typed by `FpgaDevices::XCZU9EG`,
the 9 estimates by `ZynqUltraScalePlusResources`; XCZU9EG specializes
`ZynqUltraScalePlusDevice`; `lut = 274080` sits under `XCZU9EG.capacity`.

Rule (decided 2026-11-25): only leaves (Rtl, VendorIp, HardMacro,
RegisterFile) carry estimates. A roll-up block (one with parts, or of a
roll-up kind: Subsystem, FpgaPart, ...) is the sum of its parts and may not
have an estimate: a subsystem is broken down, never estimated. An estimate on
one is an error in `ha report resources`; a roll-up block without parts is
listed "to break down". The Wi-Fi subsystems' estimates (in the SysON check
above) were removed accordingly.

## Version 0.8: performed actions through ports (2026-11-26)

What HA 1 called features and feature arcs, in SysML terms (decided with the
user: top-down composition; IP brings its own performed actions; SysML's
`perform action`, not "feature", which means any attribute, port or part in
SysML):

| JSON | SysML |
|---|---|
| part def `performs[] {name, type}` | `perform action readSensor : ReadSensor;` (existed) |
| port usage `items[] {name, direction, type}` | `port temp_read : Axi4LiteSubordinate { in item request : TemperatureRequest; }`: what the port carries |
| part def `flows[] {from, to}` | `flow from temp_read.request to readSensor.request;`: which port an action's item enters or leaves by |
| part def `allocations[]` | `allocate readTemperature.readSensor to temp_if;` (existed): who performs a step |

A step is performed by the part it is allocated to, whose def must perform
the step's action def; a flow between steps on two parts needs a wire
between their ports; an item of the action itself needs a wire from the
sheet's port. A step on a roll-up block whose action def has no steps is "to
break down"; with steps on the block's own parts it is "decomposed"
(`core/actions.py`, `ha report actions`).

SysON check: the first form, `flow from temp_read to readSensor.request`
(a port as a flow end), loaded without messages but SysON left the port end
unresolved: in SysML v2 a flow end is `feature.item`, the item being a
feature of the end's feature. Hence `items` on ports. With them, the 12 files
generated from the Wi-Fi example load with no messages, and all 24 ends of
the 12 part-def flows resolve to the right element (12 to a port of the
flow's own part def, its item an item of that port; 12 to a perform of that
part def, its item an item of the perform's action def); the 6 performs are
typed by their action defs (project `performed-actions-check-2`).

## Version 0.9: items with no item def yet (2026-11-27)

| JSON | SysML |
|---|---|
| `{"name": "temp_read", "direction": "in"}` (no `type`) | `in item temp_read;` |

Why: building a performed action by walking the sheet in HA 2 (decided with
the user, 2026-11-27). During a bid the sequence matters, not the data
types: New action… at a part gives the new action def an item for the way
in and one for the exit, named after their ports, untyped. The Actions
table types them later (a hop's item list, or New item…). SysML allows an
untyped usage, as for ports since 0.5.

SysON check: the 12 files generated from a scratch copy of the Wi-Fi fixture
walked with five new action defs (`tests/test_action_walk.py`, SKETCH:
ReceiveFrame, ReadFrame, ReturnTemp, ForwardTemp, TransmitFrame, all items
untyped) were inserted into a new SysON v2026.11 project
(`untyped-items-check-2`) as one text: accepted, no messages. Read back with
AQL: ReturnTemp's `temp_read` and `temp_read_2` are item usages with no
typing; the five actions of ReadTemperature are typed by their five action
defs; all 8 ends of its 4 succession flows resolve, each to an item of the
action def that types the action at that end (`readFrame` to ReadFrame's
`eth_int` and `temp_if`, ...).

Inserting the files one at a time (`untyped-items-check`) left 4 of the 8
ends and 2 actions unresolved: SysON resolves a text when it is inserted,
and Behavior and FpgaSys import each other. Insert the files as one text.


## Version 0.10: the address map (2026-11-27)

Decision 14 (`HANDOFF.md`): the architect sets crossbar windows in HA 2; the
crossbar and top-level `.rdl` files are generated from them; a memory map
starts at one or more roots.

| JSON | SysML |
|---|---|
| port def `isAbstract`, `specializes` | `abstract port def MemoryMappedManager;`, `port def AxiLite :> MemoryMappedManager { ... }`: a memory-mapped bus's manager role (AXI4, AXI4-Lite, Avalon-MM, ...) |
| connection `attributes[]` | `connect crossbar.m0 to csr.csr { attribute window : AddressWindow { attribute :>> base = 0; attribute :>> size = 4096; } }`: a crossbar's window, base as an offset from the crossbar's own |
| port usage `attributes[]` | `port csr : AxiLite { attribute root : MemoryMapRoot { attribute :>> map_name = "ps"; attribute :>> base = 1073741824; } }`: where a memory map starts |

A crossbar says it is one (the user, 2026-11-27: recognising it from its
ports would be fragile, and the generator writes its `addrmap` from it): its
part def specializes the abstract part def `Crossbar` as well as its kind,
`part def AxiCrossbar1to2 :> VendorIp, Crossbar`. The kind still says who
owns its HDL (set_kind keeps the other specializations, and the kind
first); `Crossbar` says what it does. Every wired manager port of a crossbar
needs a window, and a window from a part that is not a crossbar is an error
(`core/addresses.py`, `ha report addresses`). FpgaOne's root is its PS at
0x4000_0000 (illustrative: Zynq-7000's M_AXI_GP0 from memory, not checked
against a datasheet).

SysON check: the 8 files generated from FpgaOne, inserted as one text into a
new SysON v2026.11 project (`address-map-check`): no messages. Read back
with AQL: `AxiLite` specializes `MemoryMappedManager`; both `window`
attributes are owned by connection usages whose ends resolve to
`crossbar.m0` → `csr.csr` and `crossbar.m1` → `serial.csr`, are typed by
`AddressWindow`, and their 4 redefinitions resolve to `AddressWindow`'s
`base` and `size`; `root` is owned by `ZynqPs`'s port `csr`, typed by
`MemoryMapRoot`, its 2 redefinitions resolving to `MemoryMapRoot`'s.
