# HA 2: the drawing editor

A re-imagined hdl-architect: a drawing tool over the model's SysML-shaped
JSON (`src/hdl_architect/core/schema/sysml-json.schema.json`), with HA 1's planar
column / gutter layout. The JSON files are the source of truth; HA 2 edits
them, like SysON edits its model. Box positions live in a separate layout
file next to each model file (`<file>.layout.json`), never in the model.

## Run

    scripts/ha2                     # the Wi-Fi packet router; first run sets everything up
    scripts/ha2 --path DIR ...      # another model; PORT=8800 scripts/ha2 for another port

or, with the venv active:

    ha serve --path examples/wifi_router
    # or FpgaOne
    cd examples/fpga_one && ha serve --path lib --path ip --path subsystems --path fpgas

Then open http://127.0.0.1:8765 (add `#SheetName` to open a sheet). Every
edit saves within half a second; the status at the top right says when.

## The model behind the picture

| On the canvas | In the model JSON |
|---|---|
| a sheet | a part def with parts |
| a component | a part usage; its ports are its part def's ports (so a new port appears on every instance) |
| a sheet's edge ports | the sheet's part def's own ports |
| a solid wire between components | `connect a.p to b.q` |
| a dashed wire from an edge port | `bind p = a.q` |
| a component's kind (its colour, HA 1's: grey Subsystem, green Rtl, orange VendorIp, blue HardMacro, yellow RegisterFile, purple HwPart, red FPGA) | what its part def specializes; change it with right-click, Kind… |
| an interface (port def) on a port | the port's `type`; a port may have none while exploring (drawn hollow; filled = has one) |

## Doing things

- **Add a component:** right-click a column, then pick a kind (it gets its
  own new part def) or "Add an instance of a library part"; or drag a part
  from the Library panel onto a column.
- **Connect two components:** click one, Ctrl+click the other. Each gets a
  new port named after the other, facing it, and a wire joins them.
- **Wire an existing port:** click the port (it turns orange), then click a
  component (a new port there, of the mirror interface if the port has one)
  or a sheet edge (a new sheet port, bound to it). Esc cancels.
- **Edge ports:** right-click an edge band, "Add a port". Click it, then a
  component, to bind it.
- **Interfaces:** right-click a port, "Set interface…", or drag an
  interface from the Interfaces panel onto a port. An untyped port at the
  other end of its wire is typed too: the mirror role across a connect
  (Axi4StreamTransmitter -> Axi4StreamReceiver), the same interface across a
  bind. A wire whose two ends do not match is flagged.
- **Columns:** right-click a gutter to add a column there; right-click a
  column to add one on either side or remove it (if empty).
- **Resize:** drag a component's bottom edge, or its top edge (it never gets
  shorter than its ports need). Dragging the top down past a port pushes the
  port down, and the wire's other end follows it.
- **Move:** drag components up and down and between columns (or select one
  and press Ctrl+← / Ctrl+→, or right-click, Move one column); drag a port
  along its side (it stays inside its block: resize the block to make room); right-click a port, "Move to the other side".
- **Flip a component:** select it and press F (or right-click, Flip): all
  its ports swap sides.
- **Move several ports to the other side:** Shift+click each port (or
  Shift+drag along a sheet edge to pick every edge port in that range), then
  press F or right-click one of them. A port's side is one setting: the
  same on every instance of its part def and on that part def's own sheet
  edge (as in HA 1).
- **Rename / delete:** right-click a component, port or wire. Delete
  removes the selected component.
- **Navigate:** double-click a component to open its sheet; the breadcrumb
  shows where you are; ◀ (or Alt+Left) goes back.
- **Undo / redo:** Ctrl+Z, Ctrl+Shift+Z (or the arrows at the top).

The canvas keeps every wire horizontal where it can: between components the
left end sets the height and the right end follows; an edge port follows the
component port it is bound to. Two components in the same column cannot be
wired ("maybe a level of hierarchy is missing", as HA 1 says).

## Clocks, resets and SYSREF: global nets

A port typed `ClockIn`/`ClockOut`, `ResetIn`/`ResetOut` or
`SysrefIn`/`SysrefOut` is global: it is drawn as a tag in its net's colour
(◂ name: fed by that net; ▸ name: drives it), never as a wire. In the model a
net is still plain SysML: a sheet port bound to the block ports it feeds
(`bind sys_clock = ethernet.clk;`), or a block's clock output connected to
them. FpgaOne's `clk` and the Wi-Fi router's `sys_clock`, `jesd_refclk`,
`sys_reset_f` show up as nets with no change to the model.

- **Add clock/reset ports:** right-click a block (Add a clock input, Add a
  reset input, Add a clock output) or a sheet edge (Add a clock/reset input
  to the sheet). They are typed with the model's ClockIn/ResetIn... (or
  `~ClockIn` where only ClockIn exists, as in FpgaLib).
- **Put ports on a net:** in the **Clocks & resets** panel, click a net,
  then click ports (click one already on it to take it off; Esc stops). Or
  click a clock port on the canvas and pick its net from the menu. A net
  takes ports of its own kind; a port of another kind (a clock port on the
  SYSREF net) is offered a type change to fit.
- **Frequency:** double-click a net's frequency in the panel, or use the
  menu on its source port; it is the source port's `frequency_hz`.
- **SYSREF and resets are paired with a clock** (`clock_port`, as spike8's
  ResetIn already had): a SYSREF is a signal sampled by its device clock, a
  synchronous reset is synchronous to one. A new SYSREF input on a block with
  one clock is paired with it; a reset is never paired by default (whether it
  is synchronous is a design decision). Otherwise click the port (or
  right-click it), "Sampled by…", or use the "pair" link on its net in the
  panel (the way to pair a sheet's own SYSREF, e.g. jesd_sysref with
  jesd_refclk). The pair is drawn as a bracket on the
  block's edge and written `port sysref : SysrefIn { attribute :>> clock_port
  = "ref_clk"; }`; the panel shows a SYSREF net with the clock net that
  samples it (`jesd_sysref @jesd_refclk`).
- **Checks:** clock/reset ports on no net; a SYSREF (or synchronous reset)
  with no sampling clock; a pairing that names a missing or non-clock port;
  a SYSREF net sampled by clocks from different nets (JESD204B subclass 1
  needs one device-clock source); an asynchronous reset feeding synchronous
  reset inputs (needs a synchroniser); a synchronous reset feeding inputs on
  another clock. A reset net is labelled by its source: `@sys_clock` or
  `async`. Pairing a reset makes it synchronous (`synchronous = true`);
  "no clock (asynchronous)" makes it asynchronous; sources that feed nothing;
  a net with two sources; and, for a wire between two blocks that each run on
  one clock, a clock-domain crossing when the clocks differ.

## Clock tree and reset tree

**Clock tree** (top bar) draws the open sheet's clocks as HA 1's Chain
diagram did: input clocks on the left; generators (any block with a clock
output, e.g. a PLL fed by sys_clock) ranked by depth in the middle; the blocks
they drive on the right, all consumers in the last column. One colour per
clock source; hover a line for its net and frequency. Toggles: SYSREF
(dotted), and **flatten hierarchy**, which looks inside subsystems so a clock
generated three levels down shows where it comes from (nested blocks are
named `Control/core`).

**Reset tree** is the same view for resets alone (dashed lines): the reset
inputs, the blocks that synchronise or generate resets (e.g. CLK_RST_CTRL),
the blocks they reset, and resets that leave the sheet. Unlike the clock tree,
every block stays at its depth, so all the blocks one synchroniser resets
share a column.

Both are read-only: clocks and resets are assigned on the sheets. A
generated clock: give the PLL block a clock output (right-click, Add a clock
output), set its frequency in the panel, pick its net, click the ports it
drives.

## Checks

The footer lists, for the open sheet: edge ports not wired inside,
unconnected component ports, wires inside one column, wire ends that name
nothing, and how many ports have no interface yet. After each save the
server checks the whole model with `fpga_ir.py`'s loader (schema, names,
imports); its errors appear there too. A save that breaks the schema is
refused and says why.

## Export for documentation

**Export** (top bar) saves the current sheet as SVG or PNG (twice the screen
resolution); the clock and reset tree windows have their own **SVG** / **PNG**
buttons. Exports are always in the light theme, without editing marks
(selection, armed or picked ports, resize grips), and are standalone files:
the styles are inside the SVG, so it renders the same in a browser, Inkscape,
Word or a documentation build.

## Saving

The server writes a model file only when its content changed, in canonical
form (keys in schema order, 2-space indent): opening and saving without an
edit leaves every file byte-identical (tested on FpgaOne and the Wi-Fi
router). Numbers keep their float form (`100000000.0` stays a Real).

A save is refused if the file (or its layout) changed on disk since the page
loaded it, e.g. another program or browser tab wrote it: the status shows
"changed on disk: reload" and the problems list names the file. Reload the
page to pick up the change; edits made since the last good save are lost.

## Not yet (see the task list in ../HANDOFF.md)

- a CSR bus as a global net;
- importing HA 1 drawings (`fpga-hierarchy (*.json)`);
- protocol (port def) and HW part editors; feature arcs and the sequence view;
- resource estimates; a new package (file) from the tool.
