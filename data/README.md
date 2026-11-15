# Data

- `device-library.csv`: total resource capacity per device
  (`Vendor, Family, Device, Resource Type, Value`) for AMD, Altera and
  Microchip FPGAs. The editor's resource-utilization view compares a design's
  estimated usage against these totals to show percent of capacity. It can be
  loaded through the editor's **Device Library** dialog.
- `resource-utilization-sample.xlsx`: a small hierarchical breakdown (LUTs,
  FFs, DSPs, RAMB36, UltraRAM per component) showing the shape of the
  per-component data the tool rolls up.

The device figures are reference numbers. Check them against the vendor
datasheets before relying on them for anything.
