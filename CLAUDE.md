# CLAUDE.md

hdl-architect: FPGA architecture as **SysML-shaped JSON** (one JSON object =
one SysML element, validated by `src/hdl_architect/core/schema/sysml-json.schema.json`),
drawn in **HA 2** (browser editor), read by **deterministic generators**
(VHDL, compile scripts, SysML text, FuseSoC cores, later documents). A
personal open-source proof of concept (GPL-3.0); the example designs are
made up.

**Start by reading `HANDOFF.md`** (current state, decisions, open questions,
task list). History of how we got here: `docs/history/` (the SysML spike,
frozen in `~/projects/sysmlpy_spike`).

## Layout

- `src/hdl_architect/core/`: the schema, `model.py` (the model loader),
  `files.py` (reading model files and writing them in canonical form, for
  every writer) and `ops.py` (model operations: named, validated edits such as
  `connect`, shared by HA 2's server and the `ha` commands).
- `src/hdl_architect/editor/`: HA 2 (`server.py` + `static/`). User guide:
  `docs/ha2.md`. The browser code is ES modules loaded from `static/main.js` (no build
  step): `state`, `svg` (the
  drawing toolkit), `statusbar` (hint and status), `dialogs` (asking for a
  name or text), `model`, `nets`, `layout`, `store`, `edits`, `menus`,
  `render`, `interaction`, `clocktree`, `export`. No `util`/grab-bag module:
  a helper goes where its job is. `main.js` exposes every
  module's exports as `window.ha2` for the tests and the browser console.
  Model rules live in `core/ops.py`, never in the browser. Every model
  change is a named operation in `core.ops.operations()` (wiring,
  interfaces, ports, parts, definitions, nets, wires, descriptions, names,
  estimates, the device; in `core/action_ops.py` the performed actions:
  performs, steps, their items, item via port; and in `core/action_links.py`
  the actions table: a row's ingress and egress (replacing an item), the
  links between rows worked out from the wires, and a port's items),
  run by the same table from HA 2 (`POST /api/op`; `applyOp` in `store.js`:
  save pending edits, run, take the files, one undo step), from `ha op NAME
  key=value ...` (`ha op --list`; the most used also as `ha connect`,
  `ha set-interface`, `ha add-port`, ...) and later an MCP server. The
  browser's own `mutate` changes only the layout (columns, port sides). A new
  model change is a new operation with Python tests (it must leave the model
  checking) and a browser test. Known debt (UI-internal now): `nets`, `edits`
  and `store` still import `render`/`menus`.
- `src/hdl_architect/generators/`: one module per generator, each with
  `main(argv)`, registered under the `hdl_architect.generators` entry point
  in `pyproject.toml` (plugins, the PeakRDL pattern).
- `src/hdl_architect/flow/`: orchestration (the scaffolder).
- `templates/`: example Copier templates. Real team templates live in their
  own git repos (Copier versions them by tag).
- `examples/fpga_one/`: the regression design (model JSON next to its leaf
  RTL). `examples/wifi_router/`: the design the user draws in HA 2.
- `ha.toml` (per design, e.g. `examples/wifi_router/ha.toml`): settings for
  the `ha` commands, read by `core/config.py`; paths relative to the file,
  unknown keys are errors, command-line options override it. Tool
  configuration, not a design input. New options become new keys there.
- `tests/`: pytest. `tests/golden/` holds FpgaOne's expected generated files.
- `gen/`, `sim/`, `ws/` under examples are generated and gitignored.
- HA 1 is the git tag `ha1` (no HA 1 files on the branch); its docs are in
  `docs/ha1/`.

## Layers (enforced by `tests/test_layering.py`)

- `core` imports nothing else of ours.
- `generators` import `core` only: never the editor, never each other.
- `editor` imports `core` only (it may run a generator as a command).
- `flow` may import `core` and `generators`.
- A generator that wants another generator's code is a sign the code
  belongs in `core`.

## Environment

- WSL2. Python 3.14 venv at `.venv`: `pip install -e ".[scaffold,flow,test]"`
  (pinned: jsonschema 4.25.1, copier 9.19.1, PyYAML 6.0.3, fusesoc 2.4.6,
  pytest 8.4.2). Activate it first; `ha` is the command.
- GHDL at `/usr/bin/ghdl`. Questa Intel Starter FPGA Edition 2023.3 at
  `~/intelFPGA_lite/23.1std/questa_fse/bin` (not on PATH); its licence
  variables (`LM_LICENSE_FILE`, `SALT_LICENSE_SERVER`) are exported in
  `~/.bashrc` only, so non-interactive shells must set them. Starter runs
  UVM, but `randomize()`/`randcase`/`randsequence`/covergroups need a
  licence it lacks.
- Vivado is NOT installed: anything needing it is blocked; say so.
- Install companion tools into the venv when a task needs them, at a pinned
  version: vsg, elfws, peakrdl, rdlfmt, pandoc (pypandoc-binary). stacv is
  in `~/projects/sta-constraint-validator` (read its `AGENTS.md` first).
- Hosting: GitHub (`origin`), like the user's other projects. Work happens
  on branches; commit and push only when the user asks.

## Formatting and linting

- Python: Black 26.10.1 (`pip install -e ".[dev]"`; `black src tests`),
  Black's defaults (88 columns).
- HA 2's browser code (`editor/static`: JS, CSS, HTML): Prettier 3.10.1
  (`npm install` once; `npm run format`), Prettier's defaults.
- Linters: flake8 7.5.0 for Python (`flake8`; settings in `.flake8`, Black
  compatible) and ESLint 10.15.0 for HA 2's browser code (`npm run lint`;
  `eslint.config.mjs`: the recommended rules, plus the Clean Code rules
  below on every file not in its `NOT_YET_CLEAN`). HA 2's browser code is ES
  modules: each file imports what it uses. Fix findings; do not switch
  rules off without asking.
- Never format files with their own writer: model JSON and layouts (HA 2's
  canonical form), `tests/golden/`, templates, docs (`.prettierignore`).
- A formatting-only commit goes in `.git-blame-ignore-revs`. Never mix
  formatting with other changes in one commit.

## Code style (Clean Code)

The maintainer reads this code as an electrical engineer, not a JavaScript
developer: code must read as what it does. Compact idioms that need
decoding are defects, however short. The spikes did not follow this; the
code is being brought up to it one file per PR (HA 2's browser code first,
then the Python).

- **Small functions, one level of abstraction each.** A function either
  does one step itself or calls named steps; it does not mix the two.
  Extract a function rather than write a comment explaining a block.
- **A comment explaining a line is a missing name.** Name the condition or
  step instead (`if (modelHasNoSheets()) return;`, not
  `if (!sheet) return; // an empty model`). Comments say why, not what.
- **Names say what a thing is**, in full: no one- or two-letter names
  except `x`, `y`, `id`. Use SysML's terms; prefix with `sysml` where a
  word is also a programming term (`model.allSysmlPackages()`).
- **Every call says where it is defined.** Import a module by name, not
  names from it: `import * as store from "./store.js"`, then
  `store.undo()` (as Python's `import store`). A call without a prefix is
  defined in the same file. (`export.js` is imported as `diagramExport`:
  `export` is a reserved word.)
- **At most 3 arguments.** More means they belong together: pass one
  object (a data class in Python).
- **No true/false arguments.** A flag argument means two functions: split
  it into two, each named for what it does.
- **Plain control flow:** `if` statements, not `a ? b : c` chains or
  `a || b` used as a decision (`x || default` for a missing value is fine);
  at most 2 levels of nesting; at most 6 paths through a function.
- **No hidden shared state:** state has one owner module; others go
  through its functions. (`editor` in `state.js` is shared by most modules
  today; move each field to its owner as files are cleaned.)
- **Long functions (over 20 lines) are flagged, not refused:** after
  extracting functions, list the ones still long for the maintainer to
  review. Some are fine.

ESLint checks what a tool can (`eslint.config.mjs`, `CLEAN_CODE`): argument
count, true/false arguments to our own functions, named imports, paths,
nesting, nested
`?:`, name length, and function length as a warning. They apply to every
file, new ones included, except those in `NOT_YET_CLEAN`; a clean-up PR takes
its file off that list, so it cannot slip back. The rest
(one level of abstraction, names that say what they do) is checked in
review.

## Verifying a change

- Always: `scripts/check` (what CI runs on every PR: Black, flake8, the
  tests with GHDL, every example model checks, generators reproducible,
  Prettier, ESLint). `scripts/check python` or `scripts/check js` for half.
  CI (`.github/workflows/ci.yml`) runs it on Python 3.11 and 3.14.
- After changing the schema, the loader or a generator: also regenerate
  FpgaOne and compile it with Questa (`vsim -c -do compile.do` in
  `examples/fpga_one/sim`). If a generated file changes on purpose, update
  `tests/golden/` in the same change and say why.
- After a schema change that adds a construct, or a change to the SysML
  generator: regenerate the SysML text and load it into a new SysON project
  (`~/tools/SysON/start.sh` starts SysON and its MCP server). Check that
  references resolve to the RIGHT element, not only that they resolve: every
  chained end's target must be a member of the first element's type (on
  2026-11-25 all `Control.x` ends resolved, every one to the wrong element).
  Procedure: `docs/history/schema-notes.md`, "SysON check".
- After an HA 2 change: `npm run test:ha2` (in `scripts/check js`): a real
  `ha serve` on a scratch copy of `tests/ha2/fixtures/wifi_router` (a frozen
  copy of the example; never the user's live `examples/`), the page in
  headless Chromium (Playwright; `npx playwright install chromium` once).
  Tests reach HA 2's functions through `E(page, expr)`, which looks names up in
  `window.ha2` first, then the page's globals.
  The rendering goldens in `tests/ha2/golden/` (SVGs you can open) must stay
  byte-identical unless the drawing is meant to change: then
  `UPDATE_GOLDEN=1 npm run test:ha2` and say why in the PR. A new HA 2
  feature comes with a test in `tests/ha2/`. Ask the user to reload after a
  change (and, if Python changed, to run `scripts/ha2` again: it restarts
  a running HA 2).
- The model JSON is the source of truth. Change the JSON, then regenerate.
  SysML text is an output, never edited or read back. The schema admits no
  concept SysML does not have: a new need becomes a SysML construct or a
  `metadata def`, never an ad hoc field (use `doc` for descriptions).
- Never hand-edit anything under `gen/`; never write container
  (Subsystem/Fpga) VHDL by hand.
- Three kinds of HDL, by owner:
  - Container (Subsystem, Fpga, FpgaPart): generated, overwritten every run.
  - RegisterFile: the model owns its ports; PeakRDL owns its register
    logic. How the two are joined is OPEN (`HANDOFF.md`). Until decided,
    the VHDL generator writes a skeleton.
  - Rtl (leaf): written once as a skeleton, then the designer's. Never
    overwrite it unless the user asks.
- Only `core/model.py` reads model files (HA 2's server writes them through
  its canonical form). `generators/sysml.py` reads the JSON only to print it.
  Generators are pure functions of the IR: byte-identical output for the
  same model, no timestamps.
- `library` and `language` are SysML keywords: use `vhdl_library`,
  `hdl_language`.
- Ports are defined from the driver side. The other side is either
  `"conjugated": true` on the port, or a named role (`"conjugateOf"` on the
  port def; the loader reports a role as its base type, conjugated).
  `bind` = boundary-to-child (same directions); `connect` = child-to-child
  (opposite directions).
- Layer rules for model packages: IP imports only FpgaLib; subsystems import
  IP; FPGA files import subsystems. OPEN: moving blocks up a level breaks
  this (FpgaOne importing UartIp); the user decides whether to relax it.
- Generator problems are warnings with a non-zero exit code (CI fails on
  them).
- Multiple architectures per entity: OPEN, do not implement. Explicit
  `entity lib.name(arch)` binding: the user's call (not done yet).
- Prefer existing standards and tools (FuseSoC/Edalize, Copier, PeakRDL,
  CycloneDX, VUnit/OSVVM/cocotb, Pandoc) over inventing formats. Before
  writing any new tool, search for an existing one and report it.

## Companion tools: integrate, never replace

- **VSG** owns VHDL style (team config, pinned version): `--fix` on
  generated VHDL and on a new Rtl skeleton; check-only on designer files.
- **SystemRDL + PeakRDL** own registers. The model never describes
  registers; a leaf `.rdl` never refers to the system. `.rdl` files are
  hand-written (no authoring tool). Proposed, not decided: the architect's
  address map in HA 2 generates the top-level `.rdl` and crossbar config.
- **rdlfmt** owns SystemRDL formatting.
- **stacv** owns external-interface timing constraints.
- **ELFWS** owns warning triage of tool logs.
- **Wrappers** put a vendor's or tool's interface behind the model's ports.
- **FuseSoC/Edalize** is the flow runner (flow API, not the deprecated tool
  API). A CAPI2 `.core` file is each block's manifest (files, VHDL library,
  dependencies, licence). Container cores are generated; a designer's leaf
  core and an external IP's own core are hand-written and never
  overwritten. `@HdlSource`/`@IpConfig`/`@Provenance` are to move from the
  model into cores (decided, not done).
- **Copier** applies the team's project and block templates (scaffolder);
  `copier update` needs the workspace in git.

CI gates: command line, non-zero exit on failure, JUnit XML.

## Design inputs written by hand

The model JSON, SystemRDL, leaf RTL (with its `.core`), stacv TOML, ELFWS
waivers. Anything that adds another kind needs the user's explicit
agreement (pending: the sequence file, `HANDOFF.md` B19; the workspace map
of 2026-11-22 turned out unnecessary, pending the user's confirmation).
Tool configuration, templates, generator code and tests are not design
inputs.
