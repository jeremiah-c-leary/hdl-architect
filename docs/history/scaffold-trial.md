# Scaffolder trial: Copier + FuseSoC (spike10, 2026-11-22)

> Historical note, copied from `sysmlpy_spike` at the move (2026-11-25). Paths
> refer to that repository; the maintained code is in `src/hdl_architect/`.

A throwaway trial, not a tool yet. `scaffold.py` reads the model (through
`layered/fpga_ir.py`), applies the team's Copier templates to new blocks, and
regenerates container VHDL and `.core` files. `templates/` holds three Copier
templates (in the trial each was its own git repo, tagged v1.0.0 / v1.1.0;
Copier versions templates by git tag).

From this folder (copier==9.19.1 and fusesoc==2.4.6 are in the venv):

    source ../../.venv/bin/activate
    python scaffold.py --path ../model-json --top WifiPacketRouterFpga --ws ws --templates templates --project wifi
    fusesoc --cores-root ws run --target sim --build-root build acme:wifi:wifi_packet_router_fpga

`--ws` is the workspace to create or update (here `ws/`, next to this
README); `--path` is the model (repeatable). Running it again updates the
same workspace. Delete `ws/` (and `build/`) to start over.

## What it does

| Block | First run | Later runs |
|---|---|---|
| new workspace | `project` template: folders, fusesoc.conf, answers (vendor, library, part, folder rules) | - |
| Rtl, no core | `rtl-block` template + entity skeleton from the model's ports | core found: untouched |
| Subsystem / FpgaPart | `subsystem` template (folder, README) | gen/<entity>.vhd and gen/<entity>.core regenerated |
| anything else, no core | reported missing | same |

A block's core is found by name (`vendor:library:<snake name>`), anywhere
under the workspace. Children's VHDL libraries come from their cores'
`logical_name`, not from the model. The project's settings and folder rules
are the project template's answers (`.copier-answers.yml`): no workspace.json.

## Results on the WiFi model (scratch copy)

- 9 blocks: 2 Rtl created from the template, 7 containers generated.
- FuseSoC (Edalize flow API, GHDL) analyzed all 9 libraries, elaborated and
  ran the top. Warnings left: undriven outputs of the 6 subsystems that are
  still empty inside.
- Optional piece: `has_registers=true` adds `regs/<entity>.rdl` and a `regs`
  fileset; `false` leaves no trace.
- Rerun: designer edits to rtl/*.vhd and the block's .core were kept.
- `copier update` to template v1.1.0 (adds doc/): added the folder, kept the
  designer's edits, BUT only works if the workspace is in git ("Updating is
  only supported in git-tracked subprojects"). An SVN-only workspace cannot
  take template updates.

## Found along the way

- fpga_ir's JSON front end reported a role port (Axi4StreamReceiver,
  `conjugateOf` Axi4StreamTransmitter) under its own name, so gen_vhdl
  rejected every role-pair connection. Fixed: it reports the base type,
  conjugated (layered output unchanged).
- Edalize's GHDL flow elaborates the top in the default library, so the top
  core has no `logical_name`.
- gen_vhdl's CONTAINERS lacks `FpgaPart` (spike10's top kind); the trial
  treats it as a container.
