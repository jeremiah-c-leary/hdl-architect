# HANDOFF

Current state, decisions, open questions and the task list. Read
`CLAUDE.md` for the standing rules. History: `docs/history/` (the SysML
spike, 2026-10 to 2026-11-24, and the Claude.ai strategy session of
2026-11-15 to 24, referred to below as **[S]** with its section number).

## Where we are (2026-11-26)

- **Moved here from `~/projects/sysmlpy_spike`** (now frozen) on branch
  `ha2`. HA 1 is the tag `ha1`. Checked after the move: FpgaOne generates
  the same VHDL, compile script and SysML text as in the spike (only the
  generator name in the header line changed); GHDL analyzes it; Questa
  compiles it with 0 errors; HA 2 serves the Wi-Fi model; the scaffolder +
  FuseSoC run. `python -m pytest`: 5 passed.
- **Working:** HA 2 (sheets, components, ports, wires, kinds, flipping,
  global nets for clocks / resets / SYSREF with clock pairing, CDC and reset
  checks, AXI4-Stream / AXI4-Lite interfaces, clock and reset trees, SVG/PNG
  export, stale-save protection); generators for container VHDL and leaf
  skeletons, Questa compile script, SysML text; the scaffolder (Copier +
  generated container cores); the `ha` command with generator plugins.
- **Resource estimates** (2026-11-25/26, PRs #29-#32): a device library
  (every Zynq UltraScale+ MPSoC, from AMD DS891 v1.11.1, with GTH/GTY);
  the FPGA's target device and per-resource margins in the model; leaf
  estimates rolled up by the core (`core/resources.py`); `ha report
  resources` and `ha report devices`; in HA 2 the resource banner (a bar
  per resource), the hierarchy view (Vivado style), the device view (every
  device of the family, "Use" to retarget) and "Estimate…" on leaves.
- **Performed actions, core** (2026-11-26, PR #34): schema 0.8 (items on
  ports, part-def flows, `perform` with doc); `core/actions.py` walks each
  step of each action the FPGA performs (performed / decomposed / to break
  down / not performed / not allocated) and finds missing wires; `ha report
  actions`. HA 2 views not built yet (next task).
- **Code quality** (PRs #21-#28): the Clean Code rules in `CLAUDE.md`,
  enforced by ESLint on every HA 2 file not in `NOT_YET_CLEAN`; `main.js`,
  `model.js` and the new modules are clean. Since then: tidy first (below).
- Checks: `scripts/check` passes: 110 pytest, plus the HA 2 behaviour tests.
- **The Wi-Fi example is incomplete on purpose** (the user's design in
  progress): `hard_macro : HardMacro2` has no core yet, so `ha scaffold`
  reports it missing and FuseSoC will not resolve the top. Five subsystems
  have no parts yet, so they are "to break down" in the resource views; its
  estimates are illustrative. `ha report actions` finds four missing wires
  in `ReadTemperature` (see "Waiting on the user", 9).

## Decisions

From the spike (2026-11-22) and [S] section A, confirmed by the user:

1. **The model is SysML-shaped JSON** with a JSON Schema; HA 2 reads and
   writes it; every save and load is validated. [S A1] (Remaining: run the
   validation in CI.)
2. **The SysML spike is over.** SysML text is generated one way, for SysON
   and exchange. Conclusions: `docs/history/spike-conclusions.md`. [S A2]
3. **FuseSoC `.core` files are each block's manifest**; leaf cores
   hand-written with the IP, container cores generated; file facts move out
   of the model into cores (not done yet). [S A3; spike D1-D3]
4. **The scaffolder owns the folder structure** through team Copier
   templates; project settings are the template's answers. A separate
   workspace map is probably unnecessary (block cores are found by name).
5. **Documentation is generated as far as possible, following the DIDs**;
   first target MIL-STD-498 SDD (DI-IPSC-81435). No DITA. [S A4]
6. **No authoring tool for SystemRDL.** [S A5]
7. **Planning tools:** MS Project for effort reasoning, Jira for
   execution. [S A8]
8. **Personal open-source project on GitHub** (unaffiliated with the
   user's employer; no data-control concerns). This replaces [S A7]'s
   GitLab plan and [S B16]; [S B30 items 1-2] do not apply.
9. **HA 2 lives here**, one repo with core / editor / generators / flow as
   separate packages, generators as plugins; Copier templates in their own
   repos; a generator moves to its own repo when it has heavy dependencies,
   its own users, or a stable schema to target. (2026-11-25)
10. **Resource estimates** (2026-11-25/26): an estimate is an attribute per
    device family (`attribute zynqUltraScalePlusEstimate :
    ZynqUltraScalePlusResources { :>> lut = 250; }`); a block specializes
    per family only when its implementation differs (SysML variability,
    later). Only leaves (Rtl, VendorIp, HardMacro, RegisterFile) are
    estimated: a roll-up block (with parts, or Subsystem/FPGA kind) is the
    sum of its parts and is broken down, never estimated. A device is an
    attribute def (its capacity in its family's resources); the FPGA names
    its target (`attribute device : XCZU9EG;`). Margins are per resource
    (`FpgaResourceMargins`, family defaults, the FPGA's own values). No
    per-instance overrides yet; estimate sources and effort later.
    Shape and SysON check: `docs/history/schema-notes.md`, version 0.7.
11. **Tidy first** (2026-11-25): no more clean-up sweeps. Before a feature,
    tidy only the code it touches, in its own PR, with a plain-English
    walkthrough of what that code does (the sweep "turned into a slog": the
    user often could not tell what the code did).
12. **Working style** (2026-11-26 retrospective): for a feature, Claude
    proposes the whole design (model in SysML terms, core, an ASCII mockup
    of any UI, extras) and decides details itself; the user decides only
    real choices. UI is agreed as a mockup before it is built. A value is
    cited to a source only if it was read from it; otherwise it is marked
    unverified (the XCZU9EG was cited to DS891 from memory, 2026-11-25).
13. **Performed actions** (2026-11-26): what HA 1 called a feature is a
    SysML `perform action`. Composition is top-down: a step added on a part
    that is not broken down yet becomes an action that part must perform;
    IP brings its own performed actions, which the architect uses rather
    than redefines. A step's inputs and outputs are items carried "via a
    port": the port declares the item (`out item frame : EthFrame;`) and
    the part def's flow names it (`flow from mac.frame to
    receiveFrame.frame;`); a bare port is not a valid flow end in SysML v2
    (SysON leaves it unresolved). No separate "arc" concept. Shape and
    SysON check: `docs/history/schema-notes.md`, version 0.8.

## Waiting on the user

1. **Address map ownership** [S A6]: the architect owns the address map in
   HA 2, and the top-level `.rdl` and crossbar config are generated. On
   2026-11-22 the user said "all the addressing is in the rdl files". A6 is
   newer; confirm it wins (it changes the rule that all `.rdl` files are
   hand-written).
2. **B21's ID register value**: setting it in each leaf `.rdl` from the
   database would make the leaf refer to the system. Proposed instead: set
   it where the generated top level places the leaf.
3. **The sequence file** [S B19] as a new hand-written design input.
4. **The model-package layer rule** broken by moving blocks up a level.
5. **Register field <-> signal mapping** and the PeakRDL join (open since
   11-13; option E favoured).
6. **Multiple architectures per entity**; explicit `entity lib.name(arch)`.
7. **Verification framework**: Questa Starter runs directed UVM only.
   UVMF (free download, licence unconfirmed) likely needs `randomize()`
   and covergroups. Options: directed UVM, OSVVM, UVVM, cocotb + pyuvm.
8. From [S E], still open: the pilot design; the Word and PowerPoint
   templates; which DIDs a CDRL would list; requirements tool; software
   coding standard; operating modes in the model or a hand-written diagram;
   the scenario tag for a feature's representative scenario.
9. **Wi-Fi `ReadTemperature`**: `decodeCommand` and `buildResponse` are
   allocated to `processing`, which has no wires to `ethernet` or
   `temp_if` (those go through `Control`). Move the steps to `Control`, or
   wire `processing`.

## Corrections to the Claude.ai session (it could not see the repo)

- [S B3] asks for a `description` field: use SysML's `doc` (already in the
  schema and HA 2).
- [S B5] generates block diagrams with Graphviz/D2/PlantUML: that loses the
  planar layout. Render HA 2's own drawing headlessly instead (the SVG
  export proved the approach). PlantUML/Mermaid stay right for sequence and
  state diagrams.
- [S B28] hook blocking direct model-JSON edits: only once the operations
  API exists (it would block HA 2 and scripted changes today).
- [S B10]'s operation layer means moving HA 2's editing operations from
  browser JavaScript into a Python core that the server, a CLI and an MCP
  server share. Agreed direction; a real rewrite of HA 2's middle, best
  done before HA 2 grows much more.
- [S B30 item 4] schema versioning: every file already has
  `schemaVersion`; migration scripts are what is missing.
- [S E] "What language is HA 2?": Python stdlib server, plain JavaScript +
  SVG, no build step.

## Open proposals (not decided; details in [S])

Interfaces on connections (2026-11-25, user: "may want to change it later"):
SysML `interface def Axi4Lite { end manager : Axi4LiteManager; end
subordinate : Axi4LiteSubordinate; }` and typed connections (`interface :
Axi4Lite connect a to b`). HA 2 would label each wire once ("Axi4Lite") and
port labels would show only the readable name (they truncate now); the
protocol library gets a real "Axi4Lite"; a typed connection checks manager
to subordinate. Needs: schema, loader, HA 2, SysON check. Interim option:
show only the name on wired ports.

Documents and reviews: modular docs with Sphinx + MyST [B1]; scaffolded vs
generated doc pages [B2]; SDD section-by-section plan, coverage gates,
document control, interface change report [B3]; SVD [B4]; DIDs applicable
to FPGAs [B23]; states-and-modes diagrams [B24]; features as SDD 4.2 [B25];
deck recipes with python-pptx [B26]; Pandoc to Word for delivery (discussed
2026-11-22).

Registers and software: register docs [B7]; SystemC / running software
early [B8]; address map, crossbar windows and leaf `.rdl` template [B13];
register view in HA 2, no editing [B14]; sequence chain to UVM / Tcl / C
[B19]; CSR hello-world test passing with skeletons [B21].

Verification: UVMF from the model with a protocol-to-agent registry [B17];
Gherkin to tests [B18]; mutation testing [B33]; coverage from scenarios
[B34].

Flow and tools: database API shared by HA 2, CLI and MCP [B10]; MCP for
other tools [B11]; CI as one `flow ci --stage` entry point [B15]; stacv
per-instance timing templates [B9]; other FPGA steps HA 2 could assist
(CDC constraints, pin planning, protocol checkers, device tree, results
back on the hierarchy, build ID, debug planning) [B20]; friction reducers
(dev container + doctor, impact analysis, change notification, one waiver
format, one-command release, wave files, MR descriptions, context packs,
metrics, worked example) [B27]; capability matrix [B31]; open-source VHDL
IP and when to write your own [B32]; WBS skeleton from the model [B22].

Process: agents evaluating the process as it is built [B28]; agent and
human design guidelines in `docs/design-guidelines.md` [B29, B29b]; gaps:
VHDL importer, schema migrations, maintainability, adoption, licences
[B30]; notes and whiteboards [B12]; process map work instructions [B6].

## Tasks

The roadmap as a table, every capability against the data it needs:
`docs/roadmap.md`. Recommended order: phase 0, then phase 2, phase 1 items
as friction shows.
[S] task numbers in brackets.

**Phase 0: consolidate**
- [x] Commit the move, push, merge to `main`; every change since is a PR.
- [x] CI on GitHub Actions: `scripts/check` on every PR and on main, Python
      3.11 and 3.14 (2026-11-25) [D2-3]. Also Black, Prettier, flake8, ESLint.
- [ ] Move `@HdlSource` / `@IpConfig` / `@Provenance` into cores; the
      compile script from cores or an Edalize Questa target [D10].
- [ ] VHDL generator: `FpgaPart` as a container (the scaffolder already does).
- [ ] Leaf drift check: a designer's entity vs the model's ports.
- [ ] Schema migrations alongside `schemaVersion` [D19].
- [ ] Design guidelines doc, baseline agent task, gate mutations [D0, D0b].

**Phase 1: HA 2 for architecture**
- [ ] Move to parent / into a subsystem (one command instead of ~10 edits).
- [x] Operations API in Python shared by HA 2 and the CLI [D4]: all 19
      model changes in `core/ops.py` (`OPERATIONS`), HA 2 via `POST /api/op`,
      `ha op` (2026-11-25). Next: an MCP server on the same table.
- [ ] Address map, windows, checks; CSR bus as a global net [D5].
- [ ] Files view (scaffold status per block); protocol editor; new package.
- [ ] Headless diagram export command for document builds.

**Phase 2: the user's process**
- [x] Performed actions: model (schema 0.8), core walk, `ha report
      actions` (PR #34, decision 13).
- [ ] **Next:** HA 2 views for performed actions [D16]: a Performs
      section, a steps editor, the sequence view (HA 1's Feature Mapping
      Visualization) and the footprint. Mockups first (decision 12).

**Estimates (E)**
- [x] Resources: model, roll-up, margins, device library, reports, HA 2
      banner, hierarchy view, device view, leaf entry (PRs #29-#32).
- [ ] Effort, rolled up like resources [S B22].
- [ ] Packages: bonded transceivers and I/O per package (DS891 Tables 2, 4).
- [ ] What the comparison cannot see: CG/EG/EV processor-system differences.
- [ ] Device view hierarchy (family, series) once there are more devices.
- [ ] Estimate sources (where a number came from), as HA 1 had.

**Phase 3: breadth**
- [ ] Registers: leaf `.rdl` template with ID + scratchpad, generated top
      `.rdl` and crossbar config, CSR hello-world test [D5].
- [ ] Verification slice with the chosen framework [D6-7].
- [ ] SDD vertical slice: Pandoc + Word template [D8]; `doc` coverage gate [D9].
- [ ] CDC constraints, protocol checkers, interrupt map, device tree [D11].
- [ ] stacv templates [D13]; dev container + doctor [D14]; impact analysis
      [D15]; waivers and `release` [D17]; WBS [D12]; capability matrix
      [D23a]; VHDL importer [D20]; CycloneDX SBOM from cores.

**Phase 4: pilot**
- [ ] A small real design (candidate: an agent-written UART through the
      full flow) [D22, D23d].
