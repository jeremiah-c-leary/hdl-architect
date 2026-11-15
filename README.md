# hdl-architect

A prototype tool to help with architecting HDL designs.

It is a single, self-contained HTML file: no build step, no server, no
dependencies to install. Open `editor/index.html` in a modern browser.

> **Status: prototype.** Expect rough edges, changing data formats, and
> features that are only partly built. See [Known issues](#known-issues).

## What it does

- **Hierarchical block diagrams.** Model a design from system level down:
  System → CCA → FPGA → subsystems and leaf components (RTL, vendor IP, hard
  macros, register files). Duplicated components share one definition, so an
  edit to one instance applies to every instance, while each instance keeps
  its own name (the VHDL `label : entity` split).
- **Ports and interfaces.** Ports can carry an interface definition with
  roles (e.g. Master / Slave) and signals, each with a direction chosen from
  the roles and a bit width. Interfaces can be organized into an
  arbitrary-depth group tree (e.g. SPI → 4 wire → SPI_4W_MODE_0).
  *(In the tool and its files these are currently called "protocols"; they
  are really interfaces. A rename is planned.)*
- **Clocks.** Clock domains and clock-port assignment, with a live diagram.
- **Resource utilization.** Per-component LUT / FF / DSP / RAM estimates
  rolled up the hierarchy and compared against a device library.
- **Deployment diagram.** A collapsible view of where components are
  allocated (under **Visualizations**).
- **Features and Feature Arcs.** Describe component behavior as ordered
  steps (right-click a component → **Edit Features…**). **Feature Mapping**,
  also under **Visualizations**, turns these into sequence diagrams that can
  be expanded and collapsed with a click, level by level, so a feature can be
  read at the FPGA level and drilled into on demand.
- **JSON export / import** of the whole design, and of the component and
  interface library separately.

## Getting started

1. Open `editor/index.html` in a browser.
2. Use **Import JSON** to load one of the designs in [`examples/`](examples/).
3. Open **Visualizations ▾ → Feature Mapping** on
   `examples/serial-dac-system.json`, pick a feature, and click a lifeline
   marked ▸ to expand it.

The [user guide](docs/user-guide.md) covers the editor in more detail.

## Repository layout

```
editor/     the tool (index.html)
docs/       user guide, design notes, and the SDD mapping effort
examples/   sample designs (see examples/README.md)
data/       device resource library and a utilization sample
```

## SDD generation (work in progress)

A longer-term goal is generating a per-FPGA Software Design Description from
the design data, following DI-IPSC-81435. The working notes, section by
section, are in [`docs/sdd-data-mapping.md`](docs/sdd-data-mapping.md): what
each DID section asks for, which parts of the model already supply it, and
what is still missing. Nothing in the tool generates an SDD yet.

DI-IPSC-81435 is a US Government Data Item Description; quotations of it in
the notes are from that public document.

## Known issues

- **Import Library can orphan interface references.** It replaces the
  interface registry wholesale while leaving the diagram untouched, so ports
  that pointed at the old registry's ids can end up pointing at nothing.
- **Entity names are not user-definable.** `entityName` is limited to the
  built-in component kinds, so a specific reusable entity (for example a
  particular AXI crossbar) cannot yet be named and tracked as its own type.

## License

GPL-3.0. See [LICENSE](LICENSE).
