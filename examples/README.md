# Examples

Sample designs for the editor. Load any of them with **Import JSON**.

| File | What it is |
|---|---|
| `single-fpga-1.json` … `single-fpga-4.json` | Progressively larger single-FPGA designs (4, 7, 10, and 16 components) under a System and CCA. Block diagrams only, no features. |
| `single-fpga-ethernet-1.json`, `single-fpga-ethernet-2.json` | Larger designs (19 and 22 components) that include an Ethernet MAC subsystem with its own child sheet. |
| `top-down-step-1.json` … `top-down-step-3.json` | A top-down authoring walkthrough: starts with an empty two-CCA system and one empty feature (1 feature), adds port steps and a feature per CCA (3 features), then decomposes CCA Two into a Serial Device, an FPGA and a DAC (8 features). |
| `serial-dac-system.json` | A two-CCA system (21 components, 51 features) with a UART serial link, a DAC, interrupt handling, and a system-level "Request FPGA Two status" feature. The best design for trying Feature Mapping, including features that touch the same component more than once. |
| `serial-dac-system-earlier.json` | The same design before the "Request FPGA Two status" feature was added (48 features). |

These are illustrative models, not real products. Component names are
generic, and any part numbers or figures are placeholders.
