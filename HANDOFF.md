# HANDOFF

Current state, decisions, open questions and the task list. Read
`CLAUDE.md` for the standing rules. History: `docs/history/` (the SysML
spike, 2026-10 to 2026-11-24, and the Claude.ai strategy session of
2026-11-15 to 24, referred to below as **[S]** with its section number).

## Where we are (2026-11-25)

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
- **The Wi-Fi example is incomplete on purpose** (the user's design in
  progress): `hard_macro : HardMacro2` has no core yet, so `ha scaffold`
  reports it missing and FuseSoC will not resolve the top.

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
- [ ] Commit the move on `ha2`, push, merge to `main` (needs the user's OK).
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
- [ ] Operations API in Python shared by HA 2, CLI and MCP [D4]. Started:
      `core/ops.py` with `connect`, `set_interface`, `add_port`,
      `rename_port`, `delete_port`, `connect_new` (HA 2 via `POST /api/op`;
      `ha` commands). Next: parts and definitions, then the global nets.
      Next: the other edits in `edits.js` and `nets.js`, one per PR.
- [ ] Address map, windows, checks; CSR bus as a global net [D5].
- [ ] Files view (scaffold status per block); protocol editor; new package.
- [ ] Headless diagram export command for document builds.

**Phase 2: the user's process**
- [ ] Feature arcs per level; Feature Mapping Visualization (sequence view);
      feature footprint [D16].

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
