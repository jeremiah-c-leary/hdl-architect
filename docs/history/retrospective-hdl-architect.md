# Retrospective: the user draws in hdl-architect, Claude reviews (spike10, 2026-11-22)

> Historical note, copied from `sysmlpy_spike` at the move (2026-11-25). Paths
> refer to that repository; the maintained code is in `src/hdl_architect/`.

## What we did

Five drawings and five reviews in about 1.5 hours of work (exports at 09:35,
09:50, 10:00, 12:41 and 12:57; the user took a two-hour break). The user drew in hdl-architect (HA), exported JSON,
and Claude reviewed the JSON (`architecture/review-1.md` to `review-5.md`).

| Export | Content | Main findings |
|---|---|---|
| 29 | System -> Main Board -> FPGA boundary | HMC7044/TMP117 missing, UART TX to TX, no protocols |
| 30 | Fixes; the clock tree as clock nets | JESD refclk channel, no SYSREF to converters, undriven PHY clock |
| 32 | SYSREF added; off-card RESET | SYS_RESET drawn twice (reset and plain port), sync vs async |
| 33 | First protocols (JESD, SPI3Wire) | DAC SPI 3-wire, no SYNC, names don't map to PortDefs |
| 34 | SPI4Wire, JESD Sync; the FPGA's first level | no sample path to Ethernet, what is Controller, no clocks inside |

How this compares with the step before it: the SysML route took a day to
reach six subsystems in 291 lines across four files. The user then said "a
human can not reason about" the result, and the PlantUML block view "is not
useful". In one morning of drawing, HA reached the same level plus things
the SysML never had: the card's outside, the RF path, the clock tree, a
control hub and a separate data path.

## What worked

- **Speed and fluency.** The user thinks in pictures and HA is a picture
  tool: "I can put together a hierarchy pretty quick and evolve it." Every
  review led to a new drawing within minutes.
- **Architecture surfaced that text hid.** The Combiner (one antenna, receive
  and transmit) explained what the ADC and DAC are for. The clock tree came
  out as nets with sources. Export 34 introduced a Controller hub and a
  separate data path (ADC -> Processing -> DAC), along with homes for the
  HMC7044 SPI and the interrupts, both open in the SysML.
- **Claude's reviews from JSON.** The export is complete and easy to read with
  a short script: connections, roles, links between levels and orphans could
  all be checked. Reviews found real design issues (a crossed UART, missing
  SYSREF, the wrong SPI type, a missing sample path), not just style.
- **Division of labour.** The architect drew and decided; Claude checked
  against datasheets, the earlier model and consistency. This felt like the
  "architect plus reviewer" pairing the spike was after, more than Claude
  writing SysML did.
- **Protocols with roles** gave the same role check as our PortDefs role
  pairs: all typed links in export 34 joined opposite roles.

## What didn't work, or not yet

- **Hand-typed protocols drift.** (Claude first called the protocols "late";
  that was wrong: leaving them off the FPGA's internal links is intentional in
  the exploration phase, see the user's retrospective.) The hand-typed ones drifted from PortDefs: `JESD`
  Transmit/Receive vs `JesdTx`/`JesdRx`, two `Sdio` signals instead of one
  bidirectional line, `CSR`, `SIMO`. A 3-wire/4-wire mix-up survived into the
  FPGA sheet.
- **Global signals.** The user said clocks and resets "do not display well in
  a planar view". The clock nets are good data but invisible as lines. There
  is no board-level reset net, so SYS_RESET was drawn twice. Inside the FPGA,
  no clock or reset is assigned yet.
- **No parameters.** Lanes, frequencies and differential pairs have nowhere to
  go (the frequency field exists but stayed empty).
- **Tool bugs and gaps.**
  - The PHY clock could not be assigned (worked around with a new net).
  - A deleted component leaves an orphan sheet.
  - Every component gets default CLK/RST ports, even passive ones.
  - Protocol ids are random, so a re-import gives a different protocol.
  - Protocols on linked boundary ports are not repeated in the export.
  - The export is named by the browser (`fpga-hierarchy (34).json`).
- **Naming drift.** There are three styles of subsystem name, spaces in
  names, and ports named after the block at the other end (so links have no
  direction). Names differ from the SysML throughout (ETH_RGMII/eth_rgmii,
  CLKCTRL_SPI/clock_gen_spi, UART as two ports).
- **No behaviour.** HA holds structure only. The read-temperature scenario was
  checked by hand against the drawing. Nothing in HA records it.
- **Reviews by diffing.** Each review started from an ad hoc script. The same
  checks (role pairs, unconnected ports, orphans, unmapped protocols) recur
  every time and should be a tool.

## What we learned

1. **The architect's first draft belongs in a drawing tool, not in text.** Of
   the routes spike10 tried (text SysML, SysON, PlantUML from SysML, HA), the
   drawing was the only one the user found natural, and it carried the most
   design per hour.
2. **SysML is better as the catalog and the checked record than as the
   sketchpad.** PortDefs, part defs from datasheets, behaviour and allocation
   are where SysML added value. Drawing the hierarchy is not.
3. **The interface library is the bridge.** Most of the drift came from
   protocols typed by hand. Generating HA's protocols from PortDefs
   (deterministic ids, matching names) removes that whole class of finding.
4. **Reviews are repeatable checks plus judgement.** About half of each
   review was mechanical. The other half (no sample path, what Controller is,
   SYSREF for subclass 1) needed an architect's eye. Automate the first half
   so reviews spend their time on the second.
5. **HA is not finished, but it is close enough to keep using** (user: "not a
   completed product. It would need some work"). Its gaps are known and small
   (parameters, reset nets, ids, bugs), and the user owns the tool.

## Open question this raises

Which is the source of truth, the drawing or the SysML? This is spike7's
question, deferred again. The evidence here points to a split:
- HA owns the hierarchy and the connections.
- SysML owns the interfaces (PortDefs), the HW parts, behaviour and the
  values HA can't hold.
- A converter joins the two: HA JSON plus PortDefs to SysML, which then feeds
  the generators. It's the user's call.

## Proposed next steps

1. PortDefs -> HA protocol library generator (awaiting go-ahead).
2. HA export checker: role pairs, unconnected ports, unmapped protocols and
   roles, orphan sheets, names. It replaces the mechanical half of the
   reviews.
3. User: answer review 5 (the sample path, what Controller is), then draw the
   Controller and Processing sheets.
4. Decide the split above. If HA owns the hierarchy, write the HA -> SysML
   converter and run the existing generators (gen_views, scaffolding) on its
   output.
5. HA backlog for the user: per-port parameters, board-level reset nets,
   stable protocol ids, the PHY-clock bug, orphan sheets.

## The user's retrospective (2026-11-22)

In the user's words: "more of a soapbox than a proper retrospective". The
points:

- **HA supports the design in all phases.** This is the exploration phase:
  what would it take to implement what the customer wants?
- **No protocols between the blocks, on purpose.** "At this level one could
  argue that it is not that important. What is important is do we understand
  the dataflow. Are the proper connections there? What connections are
  missing?"
- **Reviews at this phase should ask design questions.** For example: does
  TEMP_CTRL need an interrupt back to the Controller to say a transaction is
  done, or do we poll? Claude could also propose a different architecture to
  model.
- **The FPGA sheet shows every pin on both sides** (the board side and the
  FPGA side), which makes a missed interface obvious. The spare SYS_RESET is a
  separate issue.
- **The intended order:**
  1. Decide the architecture.
  2. Set protocols on all the interfaces.
  3. Set the feature arcs, ideally on the CCA sheet first, so that coming
     into the FPGA sheet we know what the FPGA has to do.
  4. Then feature arcs on the FPGA sheet, then for each subsystem as it is
     broken down.
  5. At the end, HA's Feature Mapping Visualization shows the sequence
     diagram dynamically.
- "This just feels more natural to me than editing SysML or even asking you
  to write the SysML. All the tools we have tried to visualize the design
  have been a struggle."

## What changes for Claude's reviews

- **Match the review to the phase.** In exploration, review dataflow:
  - Can each customer feature be traced through the blocks?
  - Which connections are missing or redundant?
  - Where do the control and status paths run?
  - Where are interrupts needed, and where would polling do?
  - Propose alternatives.
- **Protocol and naming findings wait** until the architecture is decided.
- Reviews 1-5 leaned too much on consistency and naming for this phase.
