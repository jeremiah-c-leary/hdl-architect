# SysML spike: conclusions (2026-11-25)

The spike ran from late October to 2026-11-24 in `~/projects/sysmlpy_spike`
(spike2 to spike10 and `layered/`). It is over; work continues in
`~/projects/hdl-architect` (HA 2 and the generators). This note keeps the
reasoning so it is not lost. The details are in `HANDOFF.md`,
`spike10/log.md` and each spike's README.

## The question

Can SysML v2 be the single source of truth (a database) for FPGA development,
so that scripts generate the routine work (container VHDL, compile scripts,
build files, documents) and designers only write the leaves?

## The answer

**Yes, but SysML as a data model, not as a file format or a toolchain.**
The model is SysML-shaped JSON: one JSON object per SysML element, with
SysML's concepts and rules (part def / part, port def / port, conjugation,
bind vs connect, specialization for kinds, metadata defs), validated by a
JSON Schema that admits no concept SysML does not have. SysML v2 text is
generated from it, one way, for SysON and for exchange.

Shown end to end on 2026-11-22: the Wi-Fi router FPGA drawn in HA 2 ->
model JSON -> elaborated IR -> container VHDL, leaf skeletons, compile
script, FuseSoC cores -> a Copier-scaffolded workspace that GHDL, Questa
and FuseSoC build. Moving two blocks up a level in FpgaOne regenerated both
containers and left the designers' RTL byte-identical (Questa 0 errors).

## What was tried, and what it taught

| Tried | Result |
|---|---|
| **sysmlpy 0.106.0** as the parser (`spike_sysmlpy.py`, `results.txt`) | 16 probes: 6 pass through the API, 5 only by reading `dump()` text, 1 through a private field, 4 fail (inherited features, roll-ups, constraints, conjugated types flagged as undefined). Every step needed a workaround; 7 remain marked `WORKAROUND` in `layered/fpga_ir.py`. sysmlpy was only ever used to get data out, so the JSON could be the source directly. |
| **SysON** (with a patched MCP server) as viewer and editor | It loads the generated SysML in full, but its diagrams did not help anyone reason about an FPGA, and editing there was slow. Useful as a check that the SysML is valid. |
| **Hand-written SysML text** (spike8, `layered/`), and Claude writing it | It worked for programs, not for people: "a human can not reason about" 291 lines across four files. PlantUML views of it were "not useful". |
| **hdl-architect 1 (HA 1)**, a Claude-built single-file HTML prototype | In one morning of drawing it reached further than a day of SysML text (the card's outside, the RF path, the clock tree). But its own JSON format knew nothing of SysML, and it mixed data and views. |
| **HA 2** over SysML-shaped JSON (spike10) | The column/gutter planar layout from HA 1, low-friction editing, SysML underneath. The rest followed quickly: checks (CDC, reset use, SYSREF), clock and reset trees, export, and generators reading the same JSON. |

## Lessons (the user's, 2026-11-22)

1. People cannot see a block diagram by reading text.
2. As the FPGA grows, the files that define it grow harder to reason about.
3. SysML is good at cataloguing things, not at explaining them.
4. Use other people's work first: SysML's concepts, FuseSoC `.core` files,
   SystemRDL, Copier. Others have been down this road.
5. Avoiding HA 1 was a struggle; once on HA 2, things went quickly.

Added by Claude:

6. Separate the data from the views: one structured source that programs
   read, and pictures of it for people.
7. Prove the chain end to end thinly, then widen it.

## Decisions carried forward

- The model is SysML-shaped JSON (schema in `hdl-architect`); SysML text is
  generated, never edited or read back.
- HA 2 is the editor; the model loader is the only code that reads the
  model; generators are deterministic plugins.
- FuseSoC CAPI2 `.core` files are each block's manifest (file facts move out
  of the model into cores); cores may be hand-written; container cores are
  generated.
- The scaffolder owns the folder structure through team Copier templates.
- sysmlpy is not used any more.

## What stays here

This repository is frozen as the record: the spikes, `spike_sysmlpy.py` and
`results.txt` (the sysmlpy probes), the logs, reviews, retrospectives and the
legacy .sysml files. `layered/` and `ha2/` here are the versions at the
move; the maintained ones are in `hdl-architect`.
