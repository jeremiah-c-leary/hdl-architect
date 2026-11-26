# Roadmap: what the flow can produce, and the data each needs

Each row is something the flow can produce; each column is a kind of data. **●** = needed, **○** = makes it better. A row is possible once every ● column exists. Read across a row to see what a capability costs; read down a column to see what one more piece of data buys. The user decides when the value is worth the effort.

Phases (from `HANDOFF.md`): **0** consolidate, **1** HA 2 for architecture, **2** feature arcs, **3** breadth, **later**. Proposal [S B31] is to generate this table from each generator's declared inputs; until then it is kept by hand.

## The data (columns)

| Code | Data | What it is | Written in | Exists today |
|---|---|---|---|---|
| **H** | Hierarchy | part defs and parts | HA 2 | yes |
| **I** | Interfaces | port defs with signals; typed ports | HA 2 (port def editor to come) | yes |
| **W** | Wiring | connect and bind | HA 2 | yes |
| **K** | Kinds | Rtl, Subsystem, VendorIp, RegisterFile, ... | HA 2 | yes |
| **L** | Layout | positions (`*.layout.json`) | HA 2 | yes |
| **CR** | Clocks/resets | global nets, frequencies, clock pairing | HA 2 | yes |
| **D** | Descriptions | `doc` on blocks, interfaces, ports | HA 2 | partly |
| **CO** | Cores | `.core` per block: files, library, version, licence | designer, scaffolder | partly (trial; files still in `@HdlSource`) |
| **E** | Estimates | resources (and effort) per block | HA 2 | partly (resources: model, device library and `ha report resources`; HA 2 editing to come; effort later) |
| **F** | Features | feature arcs / scenarios (Gherkin) | HA 2, `.feature` files | partly (action defs in the Wi-Fi model) |
| **A** | Address map | a window (base, size) per register-bearing block | HA 2 | no |
| **R** | Registers | leaf `.rdl` files | designer | no |
| **SQ** | Sequences | register sequences by name (proposed input) | designer | no (needs your OK) |
| **VC** | VC registry | protocol -> verification component | team library | no |
| **B** | Board | pins, I/O standards, external parts' timing, traces | hardware team, part library | partly (HW part defs with datasheets) |
| **RQ** | Requirements | IDs, verification method, tags on scenarios | requirements tool | no |
| **RES** | Results | CI: builds, timing, utilization, tests, coverage | CI | no |

## The matrix

| Capability | Status | Phase | H | I | W | K | L | CR | D | CO | E | F | A | R | SQ | VC | B | RQ | RES | Note |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| **Architecture in HA 2** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | |
| Block diagrams (sheets) | done | - | ● | ○ | ● | ○ | ○ |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Diagram export (SVG/PNG) | done | - | ● |  | ● |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Wiring and interface checks | done | - | ● | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Clock and reset nets, clock/reset trees | done | - | ● |  | ● |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |
| CDC and reset-use checks | done | - | ● | ○ | ● |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |
| Move blocks between levels | planned | 1 | ● |  | ● |  | ○ |  |  |  |  |  |  |  |  |  |  |  |  | one command instead of ~10 edits |
| Address map view and checks | planned | 1 | ● |  | ● |  |  |  |  |  |  |  | ● | ○ |  |  |  |  |  | overlaps, span vs window, reachability |
| Resource roll-up, plan vs actual | partly | 3 | ● |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  | ○ | `ha report resources` rolls estimates up against the target device (Wi-Fi: XCZU9EG); HA 2 entry and display next; plan vs actual needs synthesis results |
| Feature Mapping (sequence view) | planned | 2 | ● | ○ | ● |  |  |  |  |  |  | ● |  |  |  |  |  |  |  | HA 1 had it |
| Feature footprint (highlighted path) | planned | 2 |  |  | ● |  |  |  |  |  |  | ● |  |  | ○ |  |  |  |  | computed from the scenarios |
| **HDL and build** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | |
| Container VHDL | done | - | ● | ● | ● | ● |  |  |  | ○ |  |  |  |  |  |  |  |  |  |  |
| Leaf skeletons | done | - | ● | ● |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Compile script | done | 0 | ● |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  | reads `@HdlSource` today; cores in phase 0 |
| SysML v2 text (for SysON) | done | - | ● |  |  |  |  |  | ○ |  |  |  |  |  |  |  |  |  |  |  |
| Scaffolded workspace and cores | partly | 0 | ● |  |  | ● |  |  |  | ○ |  |  |  |  |  |  |  |  |  | trial works; team templates needed |
| Leaf drift check (RTL vs model ports) | planned | 0 | ● | ● |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |
| Register file wrapper (PeakRDL) | waits on a decision | 3 |  | ● |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  | PeakRDL join undecided |
| Top-level `.rdl` and crossbar config | waits on a decision | 3 | ● |  | ● |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  | address map ownership (A6) |
| Clock constraints (create_clock, CDC) | planned | 3 |  |  | ○ |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |
| Interface timing constraints (stacv) | planned | 3 |  | ● | ● |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |
| Pin constraints | planned | later |  | ○ |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |
| Build ID register | planned | later |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  | ● |  |
| **Software** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | |
| C headers and register docs | planned | 3 |  |  |  |  |  |  | ○ |  |  |  | ● | ● |  |  |  |  |  | PeakRDL exporters |
| Interrupt map and device tree | planned | 3 | ● |  | ● |  |  |  | ○ |  |  |  | ● | ○ |  |  |  |  |  |  |
| Sequences to C and Tcl | waits on a decision | 3 |  |  |  |  |  |  |  |  |  |  | ● | ● | ● |  |  |  |  | sequence file needs your OK |
| **Verification** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | |
| Mutation tests of the gates | planned | 0 | ● | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  | tests the checks themselves |
| CSR hello-world test | planned | 3 | ● |  | ● |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  | passes with skeletons |
| Testbench structure from the model | planned | 3 | ● | ● | ● | ● |  | ○ |  |  |  |  |  |  |  | ● |  |  |  | framework undecided |
| Protocol checkers on every interface | planned | 3 |  | ● | ● |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |
| Scenarios to tests (Gherkin) | planned | 3 |  |  |  |  |  |  |  |  |  | ● |  | ○ | ○ | ● |  | ○ |  |  |
| Coverage from scenarios | planned | later |  |  |  |  |  |  |  |  |  | ● |  | ○ |  |  |  |  |  | Questa Starter lacks covergroups |
| **Documents and release** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | |
| Interface tables (IDD-style) | planned | 3 | ● | ● | ● |  |  |  | ○ |  |  |  |  |  |  |  | ○ |  |  |  |
| SDD (Word, via Pandoc) | planned | 3 | ● | ● | ● | ● | ● | ○ | ● | ○ |  | ○ | ○ | ○ |  |  |  |  |  | needs a Word template |
| SDD concept of execution, per feature | planned | 3 | ● |  | ● |  | ● |  | ○ |  |  | ● |  |  |  |  |  | ○ |  |  |
| SBOM (CycloneDX) | planned | 3 | ○ |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |
| SVD (version description) | planned | later |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  | ○ | ● |  |
| Interface change report | planned | later | ● | ● | ● |  |  |  |  |  |  |  | ○ | ○ |  |  |  |  |  | between two tagged versions |
| Review decks | planned | later | ● |  | ● |  | ● |  | ● |  |  | ○ | ○ |  |  |  |  |  | ○ |  |
| Test description and report (STD/STR) | planned | later |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  | ● | ● |  |
| Traceability matrix | planned | later |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  | ● | ○ |  |
| **Planning** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | |
| WBS skeleton for MS Project and Jira | planned | later | ● |  |  | ● |  |  |  |  | ○ |  |  |  |  |  |  |  |  |  |
| Status on the hierarchy (evidence) | planned | later | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |

## What each piece of missing data unlocks

Counting only capabilities not yet done: how many need this data (●), and how many of those it is the **last** missing piece for (assuming all the data marked "yes" or "partly" is complete).

| Data | Needed by | Last missing piece for | Capabilities |
|---|:-:|:-:|---|
| **F** Features | 7 | 4 | Feature Mapping (sequence view); Feature footprint (highlighted path); Scenarios to tests (Gherkin); Coverage from scenarios; SDD concept of execution, per feature; Test description and report (STD/STR); Traceability matrix |
| **A** Address map | 6 | 2 | Address map view and checks; Top-level `.rdl` and crossbar config; C headers and register docs; Interrupt map and device tree; Sequences to C and Tcl; CSR hello-world test |
| **R** Registers | 6 | 1 | Register file wrapper (PeakRDL); Top-level `.rdl` and crossbar config; Build ID register; C headers and register docs; Sequences to C and Tcl; CSR hello-world test |
| **RES** Results | 4 | 2 | Build ID register; SVD (version description); Test description and report (STD/STR); Status on the hierarchy (evidence) |
| **VC** VC registry | 3 | 3 | Testbench structure from the model; Protocol checkers on every interface; Scenarios to tests (Gherkin) |
| **CO** Cores | 3 | 2 | Leaf drift check (RTL vs model ports); SBOM (CycloneDX); SVD (version description) |
| **D** Descriptions | 2 | 2 | SDD (Word, via Pandoc); Review decks |
| **B** Board | 2 | 2 | Interface timing constraints (stacv); Pin constraints |
| **RQ** Requirements | 2 | 1 | Test description and report (STD/STR); Traceability matrix |
| **E** Estimates | 1 | 1 | Resource roll-up, plan vs actual |
| **SQ** Sequences | 1 | 0 | Sequences to C and Tcl |

## Reading it as a roadmap

- **Phase 0** needs no new data: it hardens what exists (cores instead of `@HdlSource`, the drift check, gate mutation tests, CI).
- **Features (F)** are needed by the most capabilities (7): the Feature Mapping view, the feature footprint, the per-feature SDD sections, the traceability matrix and, with a verification framework (VC), tests from scenarios. That is phase 2, the part of the vision with no prototype yet.
- **Address map (A) and registers (R)** are needed by 6 each and 8 together: the address map view, the top-level `.rdl` and crossbar configuration, the register file wrapper, the CSR hello-world test, C headers, the interrupt map and device tree, sequences and the build ID. They wait on one decision: who owns addresses (A6).
- **Descriptions (D)** are cheap to add while drawing and improve every document; the SDD needs them.
- **Results (RES)** come from CI, so CI comes before anything that reports status.
