// HA 2: Constants and the editor's shared state (S).

export const NAME_RE = /^[A-Za-z](_?[A-Za-z0-9])*$/;
export const KIND_COLORS = {
  // HA 1's colours (typeDefaultBgColor), by what a part def specializes
  SystemPart: "#0B980B",
  FpgaPart: "#c96a61",
  Fpga: "#c96a61",
  HwPart: "#7c5cc4",
  Subsystem: "#6b7280",
  Container: "#6b7280",
  Rtl: "#2f8f57",
  VendorIp: "#c9822f",
  HardMacro: "#2f5aa8",
  RegisterFile: "#b8960c",
  FpgaComponent: "#8a8f98",
};
export const CONTAINER_KINDS = new Set([
  "SystemPart",
  "FpgaPart",
  "Fpga",
  "Subsystem",
  "Container",
]);
export const G = {
  COMP_W: 170,
  EDGE_W: 120,
  MIN_GUTTER: 60,
  TOP: 64,
  LEFT: 16,
  PMT: 50,
  PMB: 14,
  PGAP: 22,
  MINH: 70,
  CGAP: 24,
  PORT_W: 8,
  PORT_H: 12,
};
export const COLLS = [
  "partDefs",
  "portDefs",
  "attributeDefs",
  "itemDefs",
  "metadataDefs",
  "actionDefs",
];

export const S = {
  pkgs: [], // {file, model, layout}
  defs: {}, // name -> {pkg, coll, def}
  sheet: null,
  back: [],
  sel: null, // {kind:'part', name}
  armed: null, // an end: {kind:'edge', port} | {kind:'part', part, port}
  undo: [],
  redo: [],
  saved: {}, // file -> {modelText, layoutText}: last saved, to tell what changed
  serverProblems: [],
  saveProblems: [],
  drag: null,
  picked: [], // ports picked with Shift+click: [{P, port}]
  band: null, // a Shift+drag along a sheet edge: {side, y0}
  armedNet: null, // a net picked in the Clocks panel: clicking ports puts them on it
};
