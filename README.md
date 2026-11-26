# hdl-architect

Architect an FPGA by drawing it, and let programs do the routine work.

The design is a set of **SysML-shaped JSON** files: SysML v2's concepts
(part defs and parts, port defs and ports, conjugation, bind vs connect) in
a plain JSON format with a JSON Schema, so any program can read it without a
SysML parser. You draw it in **HA 2**, a browser editor with a planar
column / gutter layout. Deterministic generators read the same JSON and
write the rest: container VHDL, leaf skeletons, compile scripts, FuseSoC
cores, SysML v2 text, and a scaffolded workspace for the designers, who then
only write the leaves.

> **Status: proof of concept**, a personal project. Expect changing formats.
> HA 1, the earlier single-file HTML prototype, is the git tag `ha1`.

## Getting started

    scripts/ha2                                   # HA 2 on the Wi-Fi example, in your browser
                                                  # (run it again to restart HA 2 after an update)

The first run creates `.venv` and installs everything. For the other
commands, activate it:

    source .venv/bin/activate
    ha serve --path examples/wifi_router          # HA 2 without the launcher
    ha check --path examples/wifi_router          # check the model

    cd examples/fpga_one
    SP="--path lib --path ip --path subsystems --path fpgas"
    ha gen vhdl $SP --top FpgaOne                 # container VHDL + leaf skeletons
    ha gen compile $SP --top FpgaOne --out sim/compile.do
    ha gen sysml $SP --out gen/sysml              # SysML v2 text (for SysON)

    cd examples/wifi_router && ha scaffold        # settings from its ha.toml; workspace in ws/wifi
    ha report resources                           # estimates rolled up, against the target device
    ha connect adc_if.cfg Control.adc_cfg         # wire two ports (from a design folder)
    ha set-interface Uart.irq --type BitIn        # set a port's interface
    ha rename-port AdcInterface.ref_clk jesd_clk  # its wires and clock pairings follow
    ha rename-def Uart UartStatus                 # every use in the model follows
    ha op --list                                  # every model operation, by name

Each design keeps its command settings in an `ha.toml` (model paths, top,
workspace, templates); command-line options override it.

Formatting: `black src tests` (Python) and `npm run format` (HA 2's browser
code, after `npm install`). Linting: `flake8` and `npm run lint`. Everything CI checks:
`scripts/check`. HA 2's behaviour tests alone: `npm run test:ha2`
(after `npx playwright install chromium`, once). Tests: `python -m pytest` (FpgaOne must regenerate byte-identical and
analyze with GHDL; the package's layering rules are checked).

## What's here

| Path | What |
|---|---|
| `src/hdl_architect/core/` | The schema and the model loader (the only code that reads model files) |
| `src/hdl_architect/editor/` | HA 2: a small server plus the browser editor ([guide](docs/ha2.md)) |
| `src/hdl_architect/generators/` | VHDL, compile script, SysML text; plugins found through an entry point |
| `src/hdl_architect/flow/` | The scaffolder (Copier templates + FuseSoC cores) |
| `templates/` | Example team templates for the scaffolder |
| `examples/` | FpgaOne (small, with leaf RTL) and the Wi-Fi packet router (drawn in HA 2) |
| `data/` | Device resource capacities (from HA 1; for the resource view to come) |
| `docs/` | The HA 2 guide; `history/` holds the notes from the SysML spike; `ha1/` HA 1's docs |

## Why SysML-shaped JSON

A long spike tried SysML v2 text with a Python parser and the SysON
viewer. SysML's concepts held up; its text and tools did not help people
reason about an FPGA. See [docs/history/spike-conclusions.md](docs/history/spike-conclusions.md).

## License

GPL-3.0. See [LICENSE](LICENSE).
