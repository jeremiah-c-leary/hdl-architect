# Claude.ai session notes, 2026-11-15 to 2026-11-24

Strategy discussion between the user and Claude (claude.ai, phone) while
the user was away from the computer. The WSL connector was unavailable, so
nothing here has been applied to the project yet.

This file **supersedes `claude_ai_session_2026-11-15_to_23.md`**. Sections
marked **(new 11-24)** were added after that file was written.

## How to use this file (for Claude Code)

0. **Where the project records live is now unclear.** Earlier sessions kept
   `HANDOFF.md` and `CLAUDE.md` in `~/projects/sysmlpy_spike/`, but the
   spike is over (A2) and the active work appears to be
   `~/projects/hdl-architect/`, which had no `CLAUDE.md` when this file was
   written. Ask the user where `HANDOFF.md` / `CLAUDE.md` should live
   before sorting this file into them.
1. Read it fully before acting.
2. Sort it into the project's own records: decisions into `HANDOFF.md`
   (decisions section), standing rules into `CLAUDE.md`, proposals into the
   open-questions part of `HANDOFF.md`, tasks into the task list. Then show
   the user a summary of what changed.
3. **Section A is decided by the user. Section B is NOT decided**: record
   those as open proposals and do not implement them without the user's OK.
4. Where this file conflicts with the current repo, the repo may be newer.
   Ask the user rather than overwriting.
5. Claude.ai could not see the repo during this session. Statements about
   the current implementation (how HDL Architect is built, what "the
   scaffolder" does) are assumptions; check them against the code.
6. DID numbers and some tool facts below are from Claude's memory; they are
   marked where they need confirming.

---

## A. Decisions made by the user

### A1. The JSON database is the source of truth
- SysML (FpgaLib concepts) provides the **schema** for a JSON database.
- **HDL Architect (HA)** reads and writes the JSON. HA is being
  reimplemented for the new database.
- Reason: sysmlpy was not 100 % and SysON lacked features; since sysmlpy was
  only used to produce JSON, the JSON became the source directly.
- Status reported by the user: VHDL is auto-generated matching the
  hierarchy and compiles.
- Claude's recommendation (not yet decided): formalize the schema as a
  **JSON Schema** and validate every save against it in CI.
- Update `HANDOFF.md`/`CLAUDE.md` wherever they still say the `.sysml`
  files are the source of truth.

### A2. The SysML spike is over (new 11-24)
- Conclusion: the JSON is the source of truth; **SysML is generated from
  the JSON**, one way only (never edited, never read back), for viewing in
  SysON or exchange with systems teams/customers.
- To do: write a short "spike conclusions" note in the repo (what was
  tried, sysmlpy gaps and workarounds, SysON gaps, why JSON won) so the
  reasoning is not lost. `spike_sysmlpy.py` and its results can be
  archived with it.

### A3. File information lives in FuseSoC core files
- Each IP's file lists live in its FuseSoC `.core` file; the JSON
  references the cores. This replaces `@HdlSource` (not an extra authored
  input) and supersedes "cores are generated, never hand-written".
- Claude's suggested split (confirm with the user): **leaf IP cores
  authored** (with the IP); **container/FPGA cores generated** from the
  database. Reference cores by VLNV (e.g. `acme:ip:uart:2.3.1`); the
  version then lives only in the VLNV.
- Check: every part a container instantiates must be a core in its
  dependency list at the matching version (holds by construction if
  container cores are generated).
- Compile ordering moves to FuseSoC/Edalize; `gen_questa_compile.py`
  reads cores or is replaced by an Edalize Questa target.

### A4. Documentation is generated as far as possible, following the DIDs
- Goal (user's words): keep users away from grunt work so they can focus
  on the valuable stuff.
- First target: MIL-STD-498 **Software Design Description**,
  DI-IPSC-81435 (check the revision and tailoring the contract cites).
- Delivered to the customer and consumed by other disciplines.
- **No DITA.** Revisit only if variant publishing, translation, or a
  contract requires it (Lightweight DITA / MDITA then).

### A5. No TUI for SystemRDL (from 11-13; still stands)

### A6. Address map is owned by the architect in HA (new 11-24)
- The architect defines the address map (window per register-bearing
  block) in HA; HA displays it.
- Crossbar address configuration is **generated** from it.
- Leaves get a **scaffolded template `.rdl`**; the leaf designer only
  writes registers and never sees a base address (leaf `.rdl` stays
  system-free and reusable). Details in B13.

### A7. GitLab for hosting and CI (new 11-24)
- The user intends to use GitLab (self-hosted Community Edition on the
  user's machine, now 64 GB RAM, or gitlab.com). Details in B16.
- `sysmlpy_spike` is not a Git repository (its `CLAUDE.md` says to ask
  before initializing one). `hdl-architect` already has a `.git` folder
  (seen 11-24), so for the active project this is about adding a GitLab
  remote and CI, not `git init`. Confirm with the user.

### A8. Planning tool roles (new 11-24)
- **Microsoft Project (MSP)**: reasoning about effort; multi-level task
  rollups, durations, virtual rollups (grouping across hierarchy levels).
- **Jira**: execution tracking ("a sea of tickets" without useful
  hierarchy). Leaf tasks are exported from MSP into Jira stories.
- The user estimates with a relative estimation method that becomes story
  points. Details in B22.

---

## B. Proposals and open questions (NOT decided)

### B1. Modular documentation with Sphinx + MyST
- Small doc pieces live next to what they describe and are assembled into
  documents with includes. Sphinx because the team already uses it; MyST
  so pieces stay Markdown.
- Includes can point outside the Sphinx source dir
  (`{include}` with `:relative-images:` / `:relative-docs:`); the toctree
  cannot, so use stub pages inside the source dir (or
  `sphinx-collections`).
- The database decides what is documented: a generator (or a
  `builder-inited` hook) writes stub pages + toctree into
  `docs/_generated/` (gitignored, regenerated every build).
- Antora if IP lives in separate repos with independent versions. Pandoc
  for `.docx`.

### B2. Scaffolding vs generation (applies to all docs)
- Scaffolder: creates human-owned files once, never overwrites; re-running
  adds pages for new IP only. Generators: content refreshed every build.
- **The scaffolder writes includes, never generated content.**
- Two-way check: pages for IP not in the design, IP without a page.
- Open: extend the existing scaffolder (assumed to create IP directories)
  or add a separate doc-scaffold command.

### B3. SDD generation plan
| SDD section | Generated | Written by a person |
|---|---|---|
| 1.1 Identification | name, version, device | - |
| 1.2 System overview | context diagram | purpose paragraphs |
| 2 Referenced documents | docs the build produced | standards, contract docs |
| 3 Design-wide decisions | included from decision records | the decisions, once |
| 4.1 Components | hierarchy diagram, component table (kind, version, vendor/internal, resources + roll-up) | one description per component |
| 4.2 Concept of execution | clock domains, reset scheme, interrupt map, address map | data-flow / timing narrative |
| 4.3 Interface design | block diagrams with ports, signal tables, connection tables, external timing (stacv) | one description per interface |
| 5 Detailed design per unit | ports, generics, register reference (PeakRDL), files and version (core) | internal design |
| 6 Traceability | matrix, if requirements tag component IDs | the links (tags) |
| 7 Notes | acronyms (partly) | rest |

- `description` field on every component, interface and port, written in
  HA when the element is created, for readers outside FPGA design.
- Gates: description coverage (fail at release, warn in development);
  `TODO` count reported, zero at release.
- Customer deliverable: generated document control (number, revision,
  date tied to release tag, revision history, distribution /
  export-control / CUI markings from metadata; approval stays human);
  deterministic output; **interface change report** between release tags
  (including **address changes**, see B13); machine-readable companions
  (C headers, register docs, address/interrupt maps, pinout/I/O/timing
  CSV, interface tables CSV/JSON); diagrams split per subsystem;
  glossary partly generated.
- First step: **thin vertical slice** in the organization's Word template
  (front matter with markings + one 4.3 table + one block diagram, via
  Pandoc). Needs the template from the user.
- (new 11-24) The document **build** must not involve an agent (must be
  reproducible). Agents help only with the prose, through the database
  API/MCP: drafting missing descriptions (written back via a
  `set_description` operation for human review), checking prose against
  the data (e.g. "32-bit" in text vs a 16-bit port), drafting the SVD
  change summary, answering reviewers' questions.

### B4. SVD (DI-IPSC-81442) generation
- 3.1 materials released, 3.2 contents (from cores + hashes + tool
  versions), 3.4 adaptation data, 3.5 related docs: generated. 3.3 changes
  (Git history + issues) and 3.7 known problems (defects + ELFWS waivers
  with justifications): generated drafts, human review. 3.6 installation:
  included work instruction.
- Build from a tagged release commit; must agree with the CycloneDX SBOM.

### B5. Diagrams
- Viewing: VS Code (WSL remote) previews, browser, or Obsidian.
- FPGA block diagrams generated from the database (Graphviz, D2, PlantUML;
  check netlistsvg). Text source in repo, SVG generated.

### B6. Process map (Visio, BPMN) and work instructions
- `.vsdx` is readable (pages, shapes, BPMN types, flows, lanes, subprocess
  links); layout needs a PDF/PNG export. Save as `.vsdx`; name subprocess
  pages like their shapes; consistent tool/file names.
- Prose in Markdown keyed by `StepId`; shapes carry `StepId` and `Tool`
  as shape data; a script stamps descriptions into shape data / tooltips
  and checks both directions.
- Tools are task properties, not steps or lanes; inputs/outputs are BPMN
  data objects. A task becomes a subprocess when it has internal steps
  worth showing. Lanes = who is responsible.
- Each task's section is a **work instruction** (owner, tool, inputs,
  outputs from the diagram; steps and "done when" by hand). Precise enough
  for a new team member = precise enough for an agent.
- Visio cannot live-link text files; preferred: a script editing `.vsdx`.

### B7. Registers: documentation
- SystemRDL documents *what* registers are (`desc`, field properties);
  PeakRDL generates HTML, C headers, PeakRDL-python.
- *How to use* them is covered by B19 (sequence chain). PSS rejected by
  the user (a new language).
- Search result: no open-source sequence tool found. Commercial: Agnisys
  ISequenceSpec / IDS-NG (their constructs grew loops and if-else: decide
  the boundary deliberately). Building blocks: hdl-registers,
  PeakRDL-python.

### B8. SystemC model and running software against registers
- Gherkin can be the specification a SystemC model must pass; the same
  scenarios run against RTL. Gherkin cannot generate the model.
- No open-source SystemRDL-to-SystemC exporter found. Options: PeakRDL-python
  (register-level simulator), PeakRDL-renode (Antmicro; real firmware;
  check Zynq UltraScale+ support), AMD QEMU + `libsystemctlm-soc`
  (probably best for Zynq; needs a small SystemRDL-to-SystemC plugin),
  C/C++ access layers with mocks (PeakRDL-halcpp).
- Only worth a model if software must start before hardware.

### B9. stacv: interface timing per block, per instance
| Piece | Holds | Owner | Lives |
|---|---|---|---|
| Part | datasheet timing of an external device | whoever adds the part | part library |
| Interface template | block's timing intent in its own port names | IP owner | with the IP, referenced from its core |
| Traces | board delays per net | hardware team | their repo, per board revision |

- A generator joins them per instance (trace ports to pins, find part and
  traces, rename ports, emit stacv input). Multiple instances are not a
  special case.
- Preferred (user's call): an interface-template feature in stacv; the
  flow only generates the port-to-pin mapping.
- Edge case: I/O through primitives/pin muxes/clock forwarding; simplest
  is to put the template on the I/O block.
- Lookup via part-library search path (check FuseSoC libraries), core,
  project config. Record part/board/IP versions; any change triggers
  re-timing. Automation candidate: layout-tool net report to trace file.

### B10. Database API shared by HA, a CLI and an MCP server
- Extract HA's **operation layer** into a core library; the GUI has no
  special powers. Command pattern: named, validated, undoable commands;
  domain-level (no JSON paths); renames update references; dry-run;
  actionable errors. GUI state stays out of the core.
- Front ends: CLI with JSON output, local MCP server (stdio), HA.
- Discover operations from use: agent does 5-10 real tasks against raw
  JSON with a question/change log; extract read operations from existing
  generators; HA actions are the write operations. Measure tokens/time/
  errors vs raw JSON. Log fallbacks to raw JSON as missing operations.
- JSON stays the source of truth; generated views are how designs are
  reviewed. CI rejects database changes failing the API's validation.
- Deterministic JSON formatting; commented example designs.
- Open: the language of the new HA (TypeScript and Python MCP SDKs exist).

### B11. MCP for other tools
- Only where an agent would hand-write complex data or interpret
  human-oriented output. stacv first needs `--json` output and actionable
  errors; later validate/check/query/`add_part` (requiring a datasheet
  source per value). Same advice for VSG, ELFWS. Database MCP first.

### B12. Notes and whiteboards
- Obsidian as an editor over existing Markdown (standard links, gitignore
  `.obsidian/`, one home per fact). Windows Obsidian on
  `\\wsl.localhost\...` or Linux Obsidian via WSLg; do not move the
  project to `/mnt/c`.
- Whiteboards: Miro (official MCP; hosted, check policy) or JSON Canvas /
  Excalidraw (file-based). Keep Visio for the formal process map.

### B13. Address map, crossbars and the leaf `.rdl` template (new 11-24)
- SystemRDL describes the **address map a crossbar produces**, not the
  crossbar (no masters, topology, per-master views, arbitration). IP-XACT
  models multiple address spaces better.
- The crossbar is structure in the database; add a **window (base, size)
  per slave port**. Generate from it: the **top-level `.rdl`** composing
  each leaf `.rdl` at its base (one map per master if views differ); the
  **crossbar configuration** (Vivado AXI crossbar ranges or open-source
  crossbar generics).
- Leaf template `.rdl` scaffolded with `addrmap` name, `regwidth`/access
  width from the bus port, example register, and the **ID + scratchpad
  registers** of B21.
- HA checks: every register-bearing leaf has a window; no overlaps;
  compiled span fits window (show headroom); alignment; every window
  reachable from a master and every path decodes; orphaned windows.
  Nested interconnects: compute absolute addresses per master path.
- HA conveniences: auto-allocate next free aligned window; reserved
  regions.
- HA views: sorted table per address space/master (block, base, size,
  span, headroom, owner); memory-map bar to scale.
- Address changes appear prominently in the interface change report.

### B14. Registers in HA: view and check, not edit (new 11-24)
- Editing `.rdl` from HA would require lossless round-tripping (comments,
  preprocessor; systemrdl-compiler drops comments, rdlfmt's tree is Rust);
  storing registers in JSON would reverse "`.rdl` is the source" and
  limit SystemRDL features.
- Recommended: HA reads the **compiled** `.rdl` and shows a register view
  per leaf, validation in place (compile errors, span vs window, missing
  descriptions), and "open in editor".
- Possible later, from evidence of friction: an "add register" action that
  appends a template block to the file and hands off to the editor.

### B15. CI pipeline as scaffolding (new 11-24)
- Scaffold a **thin pipeline file once**; its jobs call one entry point,
  e.g. `flow ci --stage fast|sim|build` (name is a placeholder).
- Gate logic lives in a **shared, versioned tool**, not in each project's
  YAML. Use GitLab `include` templates for shared pipeline parts.
- The database decides which checks run (per FPGA compile/sim; PeakRDL +
  rdlfmt only for IP with `.rdl`; stacv per instance with a template;
  ELFWS per log with waivers).
- The **same command runs locally**, for people and agents, with
  identical results.
- Stages: fast (no licenses: generation, interface checks, VSG, rdlfmt,
  docs) in a container image with **pinned tool versions**; sim (Questa);
  build (Vivado: synthesis, ELFWS, stacv). All JUnit. Release-only gates
  (description coverage, zero placeholders, SDD/SVD build) on tags.

### B16. GitLab setup (new 11-24)
- First check whether the organization already runs GitLab, and whether
  policy allows design data on a personal server or gitlab.com.
- Options: whole server self-hosted, or only a **runner** on the user's
  machine attached to an existing GitLab (runners connect outbound; far
  less maintenance).
- Self-hosting: Docker (or a Linux VM); on WSL2 set a memory limit in
  `.wslconfig`, enable systemd, beware idle shutdown; **off-machine
  backups from day one**.
- Runners: a **Docker runner** for the fast stage; a **shell runner**
  tagged `questa` / `vivado` on the machine with the licensed tools.
- gitlab.com Free (checked 11-24): private top-level namespaces up to five
  users; accounts created after 2026-01-27 limited to three top-level
  groups (personal namespace not counted); compute minutes apply to
  GitLab-hosted runners only, not to the user's own runner; storage
  quota exists (check pricing page).
- Initial repo: `git init`, `.gitignore` for generated folders (`gen/`,
  `docs/_generated/`, `__pycache__/`, `.venv/`, ...), add GitLab remote,
  push.

### B17. Verification with UVM/UVMF from HA (new 11-24)
- UVMF = a YAML-driven **generator** plus a **base class library**;
  regeneration keeps code inside its custom (pragma) blocks.
- HA generates the UVMF YAML from the database:

| Database | UVMF |
|---|---|
| Protocol with signals | Interface package (agent, driver, monitor, transaction), one per protocol |
| Leaf block | Environment with an agent per interface (active at unit level) |
| Container | Environment built from children's environments (agents go passive) |
| Test level | Bench |
| `.rdl` | Register model via PeakRDL-uvm |

- **Typed ports map to agents through a registry** (protocol type ->
  agent: existing in-house UVMF interface, commercial VIP such as Questa
  VIP, or generated for simple protocols). Conjugation decides role and
  active/passive; port parameters become agent parameters; clock/reset
  from the port's domain. Checks: every protocol used has an agent;
  record agent versions. The same registry can name protocol checkers
  (B20) and ILA setups.
- Ownership: UVMF YAML and structure generated every run; predictors,
  scoreboard specifics, step definitions, testbench stimulus written by
  people (or Claude Code from the spec).
- **Independence rule**: HA generates testbench *structure*, never
  expected *behavior*. Predictors/scoreboards come from requirements and
  Gherkin, not the RTL. When Claude Code writes them: give it Gherkin,
  requirements, `.rdl`, interface definitions; tell it **not to open RTL
  directories**; preferably a separate session from RTL work; human
  reviews predictors against the spec.
- HA additions: verification data per block (level, active/passive,
  tests-to-requirements), checks (environment per block at its level,
  agent per protocol, test per requirement), **status back on the
  hierarchy** (pass/fail, coverage from CI).
- First step: vertical slice (AXI-Lite interface package + `SerialCsr`
  environment + PeakRDL-uvm RAL + one test in Questa).
- Check first (task for Claude Code): whether the installed **Questa Intel
  Starter edition supports UVM at practical speed** (look for the UVM
  library in the install, release notes, then a hello-world and a larger
  test once the `vsim` license is installed), and whether **UVMF is
  available** to the user (distributed by Siemens, separate from some
  Questa editions).

### B18. Gherkin -> UVM tests (new 11-24)
- Cucumber-style: a **step-definition library** (step pattern -> UVM
  sequence, written once) plus a **generator** that parses feature files
  (official `gherkin` Python parser) and emits one UVM test / virtual
  sequence per scenario. **Unmatched step = generation error** (gate).
- `Given` -> setup/config (reset, RAL writes); `When` -> stimulus;
  `Then` -> checks (RAL read+expect, monitor waits with timeouts,
  assertions); tags -> test selection; scenario outlines -> one test per
  row.
- Use the existing **`gwt-taxonomy`**: interface references (e.g.
  `[I:Processor.UART1]`) identify agents and can be checked against the
  database; concurrent response steps (`And` after `Then`) -> `fork ...
  join`; "within N cycles" -> timeouts.
- Scope: basic functionality (directed). Robustness later with the same
  step definitions: constrained-random parameters, coverage, continuous
  scoreboards.
- Search first for an existing Gherkin-to-UVM generator.

### B19. One sequence chain: requirement -> Gherkin -> verified sequence -> Tcl and C (new 11-24)
The user wants this; it is the **sixth kind of authored input** (the
sequence file). **Confirm with the user and then record as decided.**

```
Requirement -> Gherkin scenario -> step "software configures the UART"
                                        | calls by name
                                        v
                 Sequence file (registers/fields by name, from the .rdl)
                                        | generated
          UVM sequence (RAL)       Tcl (JTAG-to-AXI)        C (BSP/driver)
          run by the scenario      same steps on board      same steps in SW
```

- The **sequence file is the single source** (SystemVerilog cannot be
  turned into C/Tcl). C and Tcl are **verified by construction**: same
  sequence, same register resolution, as the UVM version that passed.
  Nothing is ported by hand.
- Format: YAML or TOML (comments needed), next to the `.rdl`; fixed
  operations `write`, `read`/`expect`, `poll` (required timeout), `wait`,
  `call`; logic beyond that belongs in C. Build as a **PeakRDL plugin**.
- Boundary: sequence file = anything software does (register ops).
  UVM step definitions only = testbench-only actions (drive pins, observe
  serial output, inject errors). On hardware, checks are done by
  loopback, instruments or status registers.
- Prefer `poll` with timeout over fixed `wait` (sim time != real time).
- Generated C: calls a thin BSP access layer (`reg_read32`,
  `reg_write32`), returns an error on timeout, no dynamic memory, written
  to the software team's coding standard (likely **MISRA C** on defense
  programs; run their static analysis on the first generated functions).
  Header comment cites verifying scenarios, requirements, regression:
  ```c
  /* serial_configure: generated from serial_csr.seq.yaml.
   * Verified by: "Configure baud rate" (@REQ-123, @REQ-124), regression r1482. */
  int serial_configure(uint16_t baud_div);
  ```
- Generated Tcl: calls one small procedure set for the hardware access
  path (e.g. Vivado JTAG-to-AXI).
- Precise statement of sources: **requirements and the register map are
  the sources; sequences are verified against the design** (a failure
  means the sequence or design is wrong; the scenario/requirement
  decides).
- Replaces the user's "how do I" documents (generated from the same
  sequences, therefore verified).

### B20. Other FPGA steps HA could assist (new 11-24)
Claude's suggested top three are marked *.
- **Clocks, resets, CDC*** (biggest gap): flag every connection crossing
  clock domains and require a synchronizer/CDC block; generate
  `create_clock`/generated clocks and intentional-crossing constraints;
  reset polarity/sync/sequencing per domain (existing resets task); feed
  Vivado `report_cdc` / Questa CDC with waivers like ELFWS.
- **Pin planning and I/O**: pin assignments, I/O standards, bank voltage
  checks, differential pairs, pin XDC; exchange pin lists with the
  hardware team.
- **Protocol checkers bound automatically*** to every interface instance
  (sim and formal), from the protocol registry.
- **Interrupt map and Linux device tree*** generated from the address and
  interrupt maps (Zynq).
- **Results fed back**: utilization, timing closure, power per block vs
  estimates, shown on the hierarchy (plan vs actual).
- **Build identity**: Git commit, date, version in a read-only register (or
  `USR_ACCESS`); ties hardware to the SVD.
- **Debug planning**: mark signals in HA; generate ILA config /
  `mark_debug`.
- **Review packages** (PDR/CDR) assembled from generated material.
- Program-dependent: requirements management tool (e.g. DOORS) and links
  to HA elements; DO-254 or SEU mitigation (TMR); vendor IP upgrade
  reporting.

### B21. CSR "hello world" test in the initial scaffolding (new 11-24)
- Every leaf template `.rdl` gets an **ID/version register** (read-only,
  reset value generated from the database) and a **scratchpad register**
  (read-write) at fixed offsets.
- A test **generated from the address map** reads every block's ID and
  writes/reads scratchpad patterns (`0x5A5A5A5A`, `0xA5A5A5A5`, walking
  ones). Proves crossbar config, decode, connectivity, block presence,
  byte order, and header addresses. New blocks join automatically. UVM's
  built-in register sequences (reset values, access) are the deeper
  version once the RAL exists.
- **Passes with skeletons on day one**: the register logic comes from
  PeakRDL, so architecture and integration are verified before any RTL is
  written.
- Written as a **sequence** (B19): UVM in sim, Tcl as first bring-up
  check, C as BSP power-on self-test.
- In sim, an AXI master agent stands in for the Zynq PS at its port
  (chosen from the port type).
- External cases: vendor IP without registers -> read a known-reset or
  version register, or mark skipped in the report (visible, not silent);
  off-chip interfaces -> loopback mode, external device ID register (e.g.
  WHO_AM_I), or a testbench agent on the pins. Optional "liveness check"
  per external interface in its template.

### B22. Planning: WBS skeleton from the database (new 11-24)
- **Mechanical**: WBS structure = design hierarchy; **activity templates
  per element kind** (Rtl leaf: RTL, unit verification, review,
  description; register file: `.rdl`, sequences, integration check;
  vendor IP: configure, wrap, sim model, version record; subsystem:
  integration, subsystem verification; FPGA: build, timing closure, pin/I/O
  constraints, bring-up, documentation); each activity's "done when" =
  its work instruction; **stable IDs** linking element <-> WBS item <->
  Jira story.
- **Human**: estimates (user's relative estimation), reuse status
  (database can suggest from provenance), sequencing and risk, staffing.
- Design changes produce a *proposal* for plan changes; the user accepts
  and estimates.
- Estimation help: HA suggests **comparable completed blocks** (similar
  interfaces, register count, protocols, kind) with past actuals as
  anchors; actuals per kind become calibration data.
- **Effort as a rolled-up quantity in HA**, like resources, so
  architecture options can be compared on effort while designing. HA does
  **not** schedule (durations, dependencies, leveling, critical path stay
  in MSP).
- MSP skeleton as MSP XML import, with **custom fields / outline codes**
  filled from the database (element kind, activity type, subsystem at any
  level, element ID, reuse status) so virtual rollups are a group-by.
- Jira via REST API, CSV import, or Atlassian's MCP server. Stories carry
  element ID and WBS ID so they can be regrouped by hierarchy.
- Status: **reported** (Jira) vs **evidence** (CI gates per block: RTL
  exists and passes checks, scenarios exist and pass, coverage, description
  written, `.rdl` fits window), shown per block in HA; disagreements are
  highlighted.
- Ownership: plan and estimates in MSP, execution status in Jira, nothing
  maintained in both.

### B23. DIDs applicable to FPGA development (new 11-24)
MIL-STD-498 numbers from Claude's memory: **confirm in DLA ASSIST and the
CDRL** (revision letters vary).

Usually apply:
| DID | Number | Generatable |
|---|---|---|
| Software Development Plan (SDP) | DI-IPSC-81427 | Partly (tools, versions, gates, process map, work instructions) |
| Software Requirements Specification (SRS) | DI-IPSC-81433 | Partly (traceability, qualification-method matrix) |
| Interface Requirements Specification (IRS) | DI-IPSC-81434 | Partly (external interfaces) |
| Software Design Description (SDD) | DI-IPSC-81435 | Largely |
| Interface Design Description (IDD) | DI-IPSC-81436 | Largely (interface tables, register maps, stacv timing) |
| Software Test Plan (STP) | DI-IPSC-81438 | Partly (environment, test levels, requirement-to-test matrix) |
| Software Test Description (STD) | DI-IPSC-81439 | Largely (scenarios: Given = prerequisites, When = procedure, Then = expected results, tags = trace) |
| Software Test Report (STR) | DI-IPSC-81440 | Largely (CI results per release tag) |
| Software Product Specification (SPS) | DI-IPSC-81441 | Largely (build procedure, inventory) |
| Software Version Description (SVD) | DI-IPSC-81442 | Largely |
| Firmware Support Manual (FSM) | DI-IPSC-81448 | Partly (programming work instruction, build outputs); often overlooked for FPGAs |

Sometimes: SSS (81431), SSDD (81432), STrP (81429), SIP (81428), OCD
(81430). Rarely for FPGAs: DBDD (81437), SUM (81443), SCOM (81444), SIOM
(81445), COM (81446), CPM (81447). Outside 498: ICDs (separate DID), DO-254
lifecycle data for airborne hardware. SRS/IRS/SSS **qualification
provisions** sections are generatable if each requirement records its
verification method.

Pattern: documents describing **what exists** (SDD, IDD, STD, STR, SPS,
SVD) are most generatable; documents of **intent and plans** (SDP, SRS,
IRS, STP) are mostly written, with generated tables inside.

### B24. State machine and states-and-modes diagrams (new 11-24, afternoon)
- In the DIDs, "states and modes" (SRS 3.1, SDD concept of execution)
  usually means the **operating modes of the whole FPGA** (power-up, init,
  operational, BIT, maintenance, degraded) and their triggers: a
  specification, so the diagram comes from a **text source written by a
  person**, not extracted from RTL.
- Text formats: **PlantUML** state diagrams (nested states, notes;
  `sphinxcontrib-plantuml`) or **Mermaid** `stateDiagram-v2` (renders in
  Sphinx with an extension, GitHub, GitLab, Obsidian, VS Code). Source in
  repo, SVG generated.
- Optional step further: modes in the **database** (states, transitions,
  triggers, blocks affected) -> generated mode diagram, one Gherkin
  scenario required per transition (checked), scaffolded mode register in
  the relevant `.rdl`. Only worth it if modes are shared across blocks or
  programs.
- RTL FSMs (SDD section 5): **TerosHDL** extracts FSM diagrams from VHDL
  and its documenter can include them; Yosys detects FSMs (checking, not
  drawing); commercial: HDL Designer state machine editor, Sigasi.
- RTL-extracted diagrams show what the code *does*; compare them with the
  specification diagram rather than assuming they match.

### B25. Features as the SDD concept of execution (section 4.2) (new 11-24, afternoon)
- Structure for 4.2:
  1. Overview: states-and-modes diagram + short narrative.
  2. Cross-cutting behavior, generated: clock domains, reset sequence,
     interrupt handling, address map.
  3. One subsection per **feature**: design-view narrative, sequence
     diagram from the feature's scenarios, architecture diagram with the
     feature path highlighted, timing/latency from scenarios ("within N
     cycles"), concurrency from concurrent response steps.
- Scenarios are written for verification, so a feature has many. **Tag the
  representative scenario** per feature (e.g. `@primary`, name to fit the
  GWT taxonomy) and use only that in the SDD; error/edge scenarios go to
  the STD. Same source, different selection.
- Levels: the hierarchical sequence diagrams collapse to subsystem
  interactions for 4.2 and expand to inside-block interactions for
  section 5.
- Section 6 traceability comes from the same scenario tags.

### B26. Generated slide decks from recipes (new 11-24, afternoon)
- A review deck (PDR/CDR/TRR) is mostly generated: architecture and
  hierarchy diagrams, interface summary, address/interrupt maps, changes
  since last review (interface change report), resources plan vs actual,
  timing closure, verification status and coverage, requirements coverage,
  schedule/effort (MSP), open issues (Jira), SDD sections as backup.
  People write purpose, key decisions and reasons, risks, asks.
- **Deck recipe with a JSON Schema**: a short YAML file listing slides in
  order, each with a `type` and parameters; each slide type is a small
  generator mapped to a layout in the organization's PowerPoint template;
  recipes are validated before generation. The recipe (not the `.pptx`) is
  the versioned source. Example:
  ```yaml
  deck: cdr
  release: v1.3
  template: company_review.pptx
  slides:
    - type: title
    - type: narrative
      source: narrative/purpose.md
    - type: architecture
      scope: fpga_one
    - type: interface_changes
      since: v1.2
    - type: resources
      scope: serial
    - type: verification_status
    - type: narrative
      source: narrative/risks.md
    - type: backup
      sdd_section: "4.3"
  ```
- Tools: **python-pptx** if the corporate template must be used (fills the
  template's layouts/placeholders; editable output); Pandoc to `.pptx`
  with a reference template (simpler, less control); Marp or Quarto if the
  template matters less.
- Keep the deck a **view**: narrative slides in separate files assembled
  with generated ones; generated slides carry a footer ("Generated from
  release v1.3 (commit abc123). Change the source, not this slide."); the
  title slide names the tag. Generate fresh per review; day-of edits are
  fine, archive the deck as the record, never reuse it as the next
  starting point.
- **Scope parameter on every slide type**: a subtree of the hierarchy *or*
  a feature. One set of slide types then gives: design review (scope =
  FPGA), subsystem walkthrough (scope = `serial`), **feature deck** (scope
  = feature), sprint demo (features completed this sprint).
- **Feature deck** contents: overview, traced requirements and status,
  sequence diagram (existing Gherkin-to-PlantUML converter), architecture
  with the feature path highlighted, interfaces crossed, registers and
  software sequences (incl. generated C functions), verification per
  scenario, open issues tagged with the feature.
- **Feature footprint is computed, not listed**: scenarios name interfaces
  via `[I:...]` references (GWT taxonomy) -> blocks/connections in the
  database; sequences called by the scenarios -> registers. Adding a
  scenario updates the footprint. (The old FPGA Architect JSON already had
  features with port-event steps.) The footprint also serves
  feature-scoped SDD sections, per-feature test reports, and a highlighted
  feature view in HA.
- **Numbered block diagrams** (the user's current practice: numbers in
  circles on the block diagram for order and blocks involved) = a UML
  **communication diagram**; generate from the same scenario as the
  sequence diagram, by placing numbered markers on blocks/connections in
  step order. Either one slide with all numbers, or **progressive reveal**
  (one slide per step, highlighting the active connection; easy to
  generate, survives PDF, unlike animations).
- PowerPoint hierarchy navigation: **hyperlinks on shapes** (click a block
  -> its expansion slide, "up" button back; python-pptx supports
  `click_action.target_slide`; survive PDF export) are the practical
  choice for generated decks. **Zoom** and **Morph** are not supported by
  python-pptx (would need raw XML); add them by hand for a specific review.
- The interactive dynamic hierarchical sequence diagrams: keep out of the
  deck (PDF loses interactivity; draws reviews into detail). Offer them as
  an **HTML companion** linked from the deck.
- MCP for the slide generator: **not worth it yet**. Generation is
  deterministic (CI, no agent); recipes are short and an agent can write
  them with the schema plus a CLI (`build`, `validate`, `list types` with
  descriptions). Agents help with narrative slides through the **database
  API/MCP**. Add a slide MCP later only if people want decks from the
  Claude apps without a shell (a thin wrapper over the CLI).

### B27. Remaining friction reducers and generation candidates (new 11-24, afternoon)
Remaining friction is mostly setup, waiting and coordination, not
generation. Claude's suggested top three are marked *.
1. **One-command environment***: a **dev container** with every tool
   pinned (same image as CI) plus a `flow doctor` command checking
   licenses, tool versions and paths, saying exactly what is missing.
2. **Impact analysis before a change***: HA (and the API) shows everything
   a rename or move affects: blocks, connections, sequences, scenarios,
   generated C functions, documents, timing constraints.
3. **Automatic notification of other disciplines***: when a merge changes
   an interface, register, address or interrupt, generate the change
   report and notify the affected team (Jira ticket or email).
4. **One waiver mechanism for all gates** (ELFWS, CDC, lint, description
   coverage, skipped hello-world blocks): one format (justification,
   owner, date, optional expiry) and a generated **waiver report** for
   reviews.
5. **One-command release** (`flow release`): tag, build, produce every
   deliverable (bitstream, SDD, SVD, STD, STR, SBOM, C headers, change
   report), packaged with hashes.
6. **Waveform setup files**: generated Questa `wave.do` (or GTKWave) per
   block and per feature; signals grouped by interface, named by protocol,
   radix by signal type; the feature footprint selects the signals.
7. **Merge request descriptions** filled automatically: interface change
   report, affected features and documents, a review checklist by change
   type (an interface change adds "software team notified").
8. **Context packs per block** for agents and reviewers: ports,
   interfaces, requirements, scenarios, registers, design decisions in one
   small file, so an agent reads that instead of exploring the repo
   (fewer tokens: the original thesis applied to agent context).
9. **Metrics over time** from CI: warnings, coverage, utilization, timing
   slack, build time, as trends.
10. **Worked example as onboarding**: FPGA One kept small and current,
    generated into a tutorial (add a block, connect it, add a register,
    write a scenario, run CI) that CI runs, so it cannot go stale.

### B28. Agents evaluating the process while it is built (new 11-24, evening)
**User's intent: start now, not when the process is complete. A more
bulletproof methodology makes adoption easier.** Treat this as a standing
practice; confirm the specific items below with the user.

Rationale: agents running the process is a goal, not a feature to check
at the end; problems found early are cheap and shape the design.

Evaluation types:
1. **Agents as users**: a fresh session (no history) gets a realistic task
   and only what the process provides (`CLAUDE.md`, work instructions, API,
   gates). Record where it guesses, falls back to raw JSON (missing API
   operation), asks what documentation should answer, or "succeeds" by
   working around a rule. Each is a process gap. Also simulates a new team
   member.
2. **Evaluation suite**: those tasks fixed, with objective checks (gates
   pass, expected structure, nothing forbidden touched), rerun whenever the
   process changes. Track success rate, human interventions, tokens,
   time.
3. **Mutation testing of the gates** (most valuable for corner cases):
   inject faults and check some gate catches each, e.g. swap two register
   addresses, flip a conjugation, drop a reset or add an unsynchronized
   clock crossing, rename an `.rdl` field without updating the mapping,
   add a waiver without justification, write a predictor that reads the
   RTL. An agent proposes mutations (especially subtle ones); scripts apply
   them and run the gates. Every mutation passing all gates is a hole.
   Report the percentage caught. (Details in B33.)
4. **Red-team agent**: explicitly searches for inputs that pass every gate
   but are wrong; findings become new checks or new mutations.
5. **Reviewer agent** over `CLAUDE.md`, `HANDOFF.md` and work
   instructions: contradictions, unwritten knowledge, missing "done when",
   rules conflicting with what the tools do.

Rules:
- **Independence**: the evaluating session is not the one that built the
  step.
- **Enforce rules mechanically**: Claude Code **hooks** block forbidden
  actions (edits under `gen/`, direct edits to the database JSON outside
  the API); CI checks catch anything that slips through.
- **Each new piece of the process ships with its own evaluation**: one
  agent task using it, a few mutations its gate must catch, and any rule
  it introduces enforced by a hook or CI check.
- Do not over-invest in evaluating parts still changing quickly (e.g. the
  database schema during the HA reimplementation); keep those small and
  expect rewrites. Test settled parts (gates, generators) thoroughly.

What stays human: deciding what "correct" means and which corner cases
matter; judging customer-document quality; judging usability and
adoption for people; approving rule changes; policy questions.

Start now with what exists:
- ~10-20 mutations against the existing gates (interface direction,
  conjugation, width; import check; duplicate names; VSG).
- **Baseline agent task now** ("add a second UART to the serial
  subsystem", fresh session, current flow): record tokens, time,
  struggles. This is the baseline the database API is later measured
  against; it can only be measured before the API exists.
- Hooks for rules already written (`gen/`, database JSON).
- One reviewer pass over `CLAUDE.md` and `HANDOFF.md`.

### B29. Agent-ready design guidelines (new 11-24, evening)
The user asked for these to be kept in mind while implementing the
process. Proposed home: the agent section of `docs/design-guidelines.md`
(see B29b), with `CLAUDE.md` pointing to it. These are rules for
**building** the process (distinct from `CLAUDE.md`'s rules for **using**
it), and a review checklist for every merge request that adds a tool or
step. Align with stacv's existing `AGENTS.md`.

Access
1. **Text and command line first.** The GUI is a front end over the same
   operations, never the only way to do something.
2. **Query, don't read.** Questions answered by commands returning small,
   exact answers, not by reading large files.
3. **Write through validated operations**, never raw file edits.
   Domain-level operations (`connect`, `rename`), validated before saving,
   with a dry run.
4. **Discoverable.** Every tool lists its operations with descriptions
   (`--help`, MCP tool descriptions); consistent names across tools.

Feedback
5. **Clear verdicts.** Non-zero exit on failure, JUnit for gates, `--json`
   output for anything an agent reads.
6. **Actionable errors.** What is wrong, where, how to fix it, and a link
   to the relevant work instruction.
7. **Fail closed.** Unknown, unmatched or missing input is an error, not a
   silent skip.
8. **Same command locally and in CI**, identical results.

Data
9. **One source per fact.** Generated files are marked and never edited;
   changes go to the source.
10. **Deterministic output.** Stable ordering and formatting, no
    timestamps; small reviewable diffs.
11. **Small context.** Scoped queries and per-block context packs; no
    whole-repo exploration needed for one task.

Rules and instructions
12. **Rules enforced mechanically** (hooks, CI), not only written down.
13. **Work instructions with an objective "done when".**
14. **Examples over prose**: commented example designs; a worked example
    kept current by CI.

Judgment and trust
15. **Agents draft, people approve** wherever judgment is involved;
    provenance recorded (generated / agent-drafted and reviewed /
    human-written).
16. **Independence** where results are checked (verification does not read
    the RTL; evaluation is not done by the session that built the step).
17. **Every new piece ships with its evaluation**: an agent task, mutations
    its gate must catch, enforcement of any rule it adds (B28).

Acceptance test for every new feature: **can a fresh agent session do this
using only the documentation and tools?** If not, the feature is not
finished.

### B29b. Human design guidelines (new 11-24, evening)
Companion to B29. **Combine both into one `docs/design-guidelines.md` with
shared, agent and human sections** (instead of a separate
`agent-guidelines.md`), and use it as the review checklist for every merge
request that adds a tool or step. Many points overlap with B29; these are
the human-specific ones.

Fit how people already work
1. **No new tools or languages without a strong reason**; prefer what the
   team uses (VS Code, Questa, Word, PowerPoint, MSP, Jira).
2. **Partial adoption is possible** (e.g. address map + registers alone).
3. **Escape hatches**: text sources can always be edited directly; nothing
   locks people into a GUI or a single path.

Ask once, at the right moment
4. **Capture information when people have it** (description when a block
   is created, justification when a waiver is added); never "document
   later".
5. **Defaults that work**; no configuration for the common case.
6. **Low ceremony for small changes**; heavyweight checks at release.

Show, don't make people dig
7. **Visual review**: diagrams, tables, highlighted feature paths,
   memory-map bars. People review a whole design by looking; agents by
   querying.
8. **Status visible at a glance** on the hierarchy in HA (verification,
   effort, plan vs actual).
9. **Change reports in plain language**: what changed, who is affected.

Trust and control
10. **Never surprise people**: never overwrite their work; generated files
    clearly marked; previews and undo before changes.
11. **The tool proposes, the person decides** (address allocation, plan
    changes, drafted descriptions).
12. **Explain where output came from**, so people trust generated documents
    enough to sign them.
13. **Respect house style where it exists** (VSG configuration); adopt a
    community style only where none exists (rdlfmt, on trial).

Speed and learning
14. **Fast feedback**: quick gates run in seconds locally.
15. **Learnable**: worked example, consistent names and concepts across
    tools, glossary.
16. **Easy to resume after an interruption**: current state visible, not
    held in someone's head.

Where humans and agents differ: **one operation, two presentations**. GUI
for people, CLI/MCP for agents, all on the same core operations;
human-readable output by default, `--json` for agents; summaries and
diagrams for people, exact queries for agents.

Human acceptance test (pairs with B29's fresh-agent test): **can a teammate
do the task after a ten-minute explanation?** Run it with a real teammate
on each new piece and keep a short **friction log** of where people
hesitate or ask questions. Both tests are needed; people and agents trip
on different things.

### B30. Gaps still to address (new 11-24, evening)
1. **AI tools and controlled design data (check FIRST; can block
   everything).** Defense design data is often export-controlled (ITAR/EAR)
   or covered by customer contract terms. Claude Code, Claude.ai, MCP
   connectors, gitlab.com and Miro send data to cloud services. Before
   agents work on real program data, the user checks with security and
   export-control staff: are AI tools approved for that data; does an
   approved deployment exist (e.g. a controlled/government cloud
   environment); which repos, if any, may live on gitlab.com. Meanwhile
   prototype on a sanitized example such as FPGA One. **Put this question
   in front of the user before starting work on real program data.**
2. **Disclosure of AI use.** Some contracts/customers require disclosure of
   AI-generated content or forbid it in deliverables. Record provenance
   from the start: script-generated (file headers already do this),
   agent-drafted and human-reviewed (review mark in the database),
   human-written.
3. **Importing existing designs.** A **VHDL-to-database importer** (entity
   declarations and structural architectures, parsed with GHDL or
   pyVHDLModel) so existing projects can join the flow without re-entry.
   Without it, adoption is limited to new projects.
4. **Database schema versioning.** A schema version in every database
   file and a **migration script per schema change**, so old designs keep
   loading while HA evolves. (Generalizes the IR-version idea from
   11-13.)
5. **Keeping the flow maintainable** (it must not become the next
   unmaintained Tcl): build on standard tools (FuseSoC, PeakRDL, Sphinx,
   UVMF) so most code is maintained upstream; evaluation suite and
   mutation tests make changes safe; more than one person able to work on
   it; agents maintain it under the same rules.
6. **Adoption path**: a **pilot project** (one real, small design entirely
   through the flow, with numbers); **partial adoption** (e.g. address map
   + register flow alone); a **champion** per team.
7. **Open-source license compliance**: several tools are LGPL/GPL (ELFWS is
   GPL-3.0). Using them is normally fine, but check with legal whether any
   generated output or bundled runtime code carries license terms into
   deliverables; list tool licenses in the SBOM.

Claude's ranking: (1) the AI data question first; then (3) the importer
and (4) schema versioning, since they decide whether real projects can
adopt the flow.

### B31. Capability matrix: what you can generate and what data it needs (new 11-24, night)
User's idea. Rows = capabilities (structural VHDL, compile script, C
headers, CSR hello-world test, SDD 4.3, feature slides, interface XDC,
...); columns = data (hierarchy, typed ports, address windows, `.rdl`,
descriptions, scenarios, clocks, stacv data, ...); cells = required /
improves. Purpose: readers and agents see the mapping; users see "one
more thing and you get X" and judge whether the effort is worth it. It
realizes the FPGA Architect user guide's principle: the user decides when
the value proposition is done; only data needed for a task is needed.
- **Keep it live**: each generator **declares its required and optional
  inputs** machine-readably; the matrix is generated from those
  declarations (a new generator adds its row).
- **HA evaluates the current design against it**: per capability,
  available, or missing N items with specifics ("SDD 4.3: 12 of 14
  interfaces lack descriptions"), sorted by how little is missing.
- Rough **effort per data item** so the view can say "3 scenarios missing,
  about an hour"; the person decides.
- Also: dependencies between capabilities (what unlocks what); scoped
  views (per block, per feature); **release readiness** (required
  capabilities fully available = release gate); agents via
  `flow capabilities --json` can offer to fill gaps; adoption (shows new
  teams what their existing data already buys).

### B32. Open-source VHDL IP and when to write your own (new 11-24, night)
Libraries (confirm licenses in each repository):
- **Open Logic** (modern VHDL standard library: FIFOs, CDC, AXI/AXI-Stream,
  UART/SPI/I2C; VUnit-tested; grew out of PSI `psi_common`).
- **PoC, Pile of Cores** (TU Dresden; arithmetic, caches, CDC, FIFOs, RAM
  wrappers, I/O incl. UART).
- **hdl-modules** (VHDL; AXI, FIFOs, resync; same authors as
  hdl-registers; permissive license as recalled).
- **SURF** (SLAC; large VHDL framework incl. Ethernet MAC/UDP, AXI,
  high-speed serial).
- Ethernet MAC: SURF; `pkerling/ethernet_mac` (VHDL tri-mode); Gaisler
  **GRLIB** (VHDL, GRETH, UARTs; open version is **GPL**, commercial
  licenses available); Alex Forencich's verilog-ethernet / **taxi**
  (Verilog/SystemVerilog; usable in mixed-language designs).
- Each adopted block becomes an IP in the database: FuseSoC core,
  provenance and license in the SBOM, typed ports mapped to protocol types
  and agents, a wrapper for naming, and its own pass through the gates
  (and seeded mutations) before being trusted. License review per B30
  item 7 (GPL / CERN-OHL-S may impose terms on the whole design).

Reuse vs agent-written IP (rule of thumb):
- **Reuse** when the block is subtle (CDC, synchronizers, async FIFOs,
  Ethernet MAC, high-speed serial), large or protocol-heavy, and under a
  shippable license.
- **Write through the flow with an agent** when the block is simple and
  well specified (UART, SPI/I2C master, PWM, timers, glue), must fit house
  conventions exactly, or license/provenance matters. Scaffolding already
  supplies core, `.rdl`, skeleton, docs; the real work is RTL,
  verification, and maintenance.
- Agent-written IP follows the full flow: requirements and scenarios
  first; RTL from one session; predictors/step definitions from a
  **separate session that does not read the RTL**; hello-world test,
  gates, seeded mutations; provenance "agent-written", human review before
  release.
- An agent-written UART is a good **pilot** (B30 item 6): small, real, and
  exercises requirement-to-verified-IP end to end.

### B33. Mutation testing in detail (new 11-24, night)
Concept: make small deliberate changes (mutants), run the tests; failing
= killed, passing = survived (tests did not notice). **Mutation score** =
killed %. Measures whether wrong values would be *caught*, unlike code
coverage (executed). Equivalent mutants (no behavior change) need a
person to set aside.

Three applications:
1. **Design-data mutations -> test the gates** (cheapest, seconds each):
   flip conjugation (interface check), overlap windows (address check),
   shrink window below span, remove reset, unsynchronized crossing (CDC),
   rename `.rdl` field without mapping update (register plugin), waiver
   without justification. Survivors = holes in the process.
2. **RTL mutations -> test the verification**: mutate operators,
   conditions, counter limits, state transitions, reset values, stuck
   signals; run scenarios/UVM. Expensive: smoke tests first, sample,
   parallel runners. Tools: Synopsys **Certitude** (commercial); **MCY**
   (Mutation Cover with Yosys, open source; check VHDL support via the
   GHDL plugin); or a simple VHDL mutator (good agent task). Limit: it
   measures checking strength, not whether the spec is right (independence
   rule still matters).
3. **Generator mutations -> test the tools** (e.g. `mutmut` for Python);
   lower priority, useful once generators produce deliverables.

Agents: generate bug-like mutants (off-by-one FIFO pointer, missed
handshake, wrong reset polarity), triage survivors, propose fixes. People
decide which survivors matter and approve new checks. Report mutation
score per gate and per block over time (reviews, STR).

When:
- **Design-data mutants**: a fixed suite in the repo (each mutant with its
  expected gate), run on every merge request touching gates, generators or
  schema, plus nightly. New gates ship with their mutants.
- **RTL mutants**: per block **when its verification is claimed done**
  (part of "verified"), before design reviews, incrementally afterward
  (diff-based on changed lines in MRs, or sampled nightly/weekly), and a
  full run at release. Early runs on immature testbenches are noise.
- **Generator mutants**: weekly, when their tests change, before release.
- Store triage (equivalent mutants, accepted survivors) in the common
  waiver format. Gate on score **drops** first; set absolute thresholds
  once realistic scores are known.

What else to mutate (priority):
1. RTL (tests the checking as a whole).
2. **Sequence file** (sequences become C/Tcl deliverables): wrong register,
   skipped poll, swapped steps, wrong value -> scenarios must fail.
3. **Drivers -> protocol checkers**: make the driver violate the protocol
   (early `valid` drop, ignore `ready`, malformed burst); bound checkers
   must fire (otherwise they only ever see correct traffic).
4. Monitors/predictors/scoreboards when RTL survivors point at a suspect
   checker (a surviving checker mutant = checking never actually compared).
5. Testbench-only stimulus: use functional coverage instead.

### B34. Functional coverage and Gherkin (new 11-24, night)
- Scenarios answer "does each required behavior work?" (directed, traced,
  pass/fail). Functional coverage answers "which situations did
  simulation reach across all tests?"
- **Scenarios define what coverage measures**: scenario outline examples
  tables are bins; generate coverpoints and their **crosses** from them
  (e.g. baud x parity: outline tests 3 of 9 combinations; the cross shows
  the other 6 unexercised).
- Directed scenarios give low coverage by design; constrained-random tests
  on the same step definitions fill it.
- **Coverage holes feed back**: adjust constraints, add a scenario, or
  exclude with justification (common waiver format). Holes can reveal a
  **missing requirement**.
- Sources: **register coverage** from `.rdl` via the UVM register model
  (generated); **protocol coverage** per protocol in its agent (generated
  once, reused); **feature coverage** from scenarios (crosses from outline
  tables generated; corner cases written, e.g. the POC's "GPIO event in the
  same cycle as a status read" as a cross).
- Tag coverpoints with scenario and requirement IDs; report coverage per
  requirement and per feature (HA hierarchy view, feature decks, STR).
- **Definition of "verified" for a block**: scenarios pass; coverage goals
  met; mutation score acceptable.

---

## C. Research findings (context)

- **TerosHDL**: bottom-up from HDL; uses VSG and Edalize; complementary
  editor for leaf RTL and code-level docs.
- **Commercial overlap**: Siemens **HDL Designer** (interface-based design
  spreadsheets, Register Assistant, checks, docs, DO-254) is the closest
  single tool; also Arteris Magillem, Agnisys IDS-NG, FPGA-PCB co-design
  tools. None combines an open Git-native data model system->board->FPGA,
  per-instance timing templates, DID documents, the user's tools as gates,
  and agent-first use. Check whether HDL Designer is licensed internally.
- **Agent preference**: text and CLI over GUI, deterministic gates, solved
  problems scripted, explicit rules; improve with a query API, safe write
  path, stable diffs, actionable errors, examples. Measure with the same
  task done with and without the flow.
- **MCP explained to the user**: a server offering named, described, typed
  tools to an AI client; local (stdio) or network (HTTP); the WSL file
  access used in these sessions is an MCP server.

---

## D. Suggested next tasks (for the user to prioritize)

-1. **Ask the user about AI tools and controlled design data (B30 item 1)**
   before working on any real program data. Until answered, work only on
   sanitized examples such as FPGA One.
0. **Design guidelines (B29 + B29b)**: create `docs/design-guidelines.md`
   with shared, agent and human sections, point to it from `CLAUDE.md`,
   and use it as the review checklist for every new tool or step. Each new
   piece passes both acceptance tests (fresh agent; teammate after a
   ten-minute explanation), with a friction log kept.
0b. **Process evaluation from now on (B28)**: baseline agent task before the
   database API exists; mutation tests on existing gates; hooks for
   `gen/` and the database JSON; reviewer pass over `CLAUDE.md` and
   `HANDOFF.md`. From then on, every task below ships with its own agent
   task, mutations and enforcement.
1. Record decisions A1-A8 in `HANDOFF.md` / `CLAUDE.md`; remove or mark
   superseded rules (SysML text as source; `@HdlSource`; cores always
   generated). Write the **spike conclusions** note.
2. With the user's OK: GitLab project and remote for `hdl-architect`
   (already a Git repo), `.gitignore` for generated folders, push. Then the
   thin CI pipeline and `flow ci --stage fast` (B15/B16).
3. JSON Schema for the database + validation in CI.
4. **Database API** (B10): discovery run, core library from generator read
   operations, common write operations, CLI with JSON output, local MCP
   server, measurement.
5. **Address map in HA** (B13) + leaf template `.rdl` with ID/scratchpad +
   generated top-level `.rdl` and crossbar config + the **CSR hello-world
   test** (B21).
6. **Questa/UVMF check** (B17), then the UVM vertical slice.
7. **Sequence file + PeakRDL plugin** (B19), once the user confirms, with
   the hello-world as the first sequence; then Gherkin-to-UVM (B18).
8. **SDD vertical slice** in the organization's Word template (B3).
9. `description` fields + coverage gate.
10. Generated container cores + hierarchy/dependency check.
11. Clock-domain/CDC checks, protocol checker binding, interrupt map and
    device tree (B20).
12. WBS skeleton generator with MSP custom fields (B22).
13. stacv interface templates and per-instance mapping; `--json` output.
14. Dev container + `flow doctor` (B27, item 1); early, since it also
    gives CI its pinned image.
15. Impact analysis and change notification (B27, items 2-3), built on the
    database API.
16. Feature footprint computation, then deck recipes with slide types
    (B26) and the SDD 4.2 feature structure (B25).
17. Unified waiver format and report (B27, item 4); `flow release`
    (item 5).
18. Waveform files, MR descriptions, context packs, metrics, worked
    example (B27, items 6-10), as time allows.
19. Database schema versioning + migration scripts (B30 item 4), early,
    before real designs exist in the new format.
20. VHDL-to-database importer for existing designs (B30 item 3).
21. Provenance recording for AI-assisted content (B30 item 2).
22. Pilot project selection and partial-adoption packaging (B30 item 6).
23. License review of the toolchain with legal; licenses in the SBOM
    (B30 item 7).
23a. Generator input declarations and the capability matrix view in HA
    (B31).
23b. Design-data mutation suite in the repo, run on MRs (B33); RTL mutation
    tooling check (MCY with VHDL, or a simple mutator).
23c. Coverage model generation: register coverage (UVM RAL), protocol
    coverage per agent, crosses from scenario outlines (B34).
23d. Pilot candidate: an agent-written UART through the full flow (B32).
24. The user's homework: list every step from "new requirement" to
    "released bitstream", marked automated / scripted by hand / manual;
    sort by frequency, error rate, reasoning needed.

## E. Questions waiting for the user

- **First:** Are AI tools (Claude Code, Claude.ai, MCP connectors) approved
  for the program's design data, given ITAR/EAR and contract terms? Is
  there an approved deployment? Which repos may live on gitlab.com?
- Do any customers require disclosure of AI-generated content in
  deliverables?
- Which small, real design could be the pilot project?
- Where should `HANDOFF.md` / `CLAUDE.md` live now that the spike is over
  (`sysmlpy_spike` or `hdl-architect`)?

- What language is the new HDL Architect written in?
- Which Word template does the SDD use?
- Which DIDs are on the CDRL, and which revisions?
- Does the organization already run GitLab? Is design data allowed on a
  personal server or gitlab.com?
- OK to add a GitLab remote and CI to `hdl-architect`?
- Confirm the **sequence file** (sixth authored input) as decided.
- Is UVMF available (through the company's Siemens access)? Does a
  separate verification team own testbenches?
- Which coding standard does the software team use (MISRA C?) and which
  static analysis tool?
- Which requirements tool is used (DOORS or other)?
- Is HDL Designer licensed at the organization?
- Does the organization have a central part library?
- I/O structures between functional blocks and pins?
- Field-to-signal mapping for register files (open since 11-13).
- Multiple architectures per entity: per instance, per build, or both
  (open since 11-13).
- Which PowerPoint template do reviews use? Which reviews (PDR, CDR, TRR)
  need recipes first?
- What tag marks a feature's representative scenario (e.g. `@primary`),
  and does it fit the GWT taxonomy?
- Should operating modes live in the database (B24) or stay as a
  hand-written diagram source?
