/* HA 2: an editor for the model's SysML-shaped JSON, with HA 1's planar
 * column / gutter layout.
 *
 * Model (saved to <package>.json, the source of truth):
 *   a sheet      = a part def with parts
 *   a component  = a part usage (its ports are its part def's ports)
 *   a wire       = `connect a.p to b.q` between components, or
 *                  `bind p = a.q` from the sheet's own (edge) port to a component
 * Layout (saved to <package>.layout.json, never model data):
 *   sheets[D] = { columns, parts: {part: {col, y, h}}, edge: {port: {side, y}} }
 *   ports[P]  = { port: {side, offset} }      (per part def: shared by its instances)
 */
import * as state from "./state.js";
import * as svg from "./svg.js";
import * as dialogs from "./dialogs.js";
import * as statusbar from "./statusbar.js";
import * as model from "./model.js";
import * as nets from "./nets.js";
import * as layout from "./layout.js";
import * as store from "./store.js";
import * as edits from "./edits.js";
import * as menus from "./menus.js";
import * as render from "./render.js";
import * as interaction from "./interaction.js";
import * as clocktree from "./clocktree.js";
import * as diagramExport from "./export.js";

// Every module's functions and state, by name: for the tests and the browser
// console (e.g. ha2.partDef('Control')). Not used by HA 2 itself.
window.ha2 = Object.assign(
  {},
  state,
  svg,
  dialogs,
  statusbar,
  model,
  nets,
  layout,
  store,
  edits,
  menus,
  render,
  interaction,
  clocktree,
  diagramExport,
);

// ------------------------------------------------------------------ start
wireButtons();
start();

/** The top bar's buttons and the library filter. */
function wireButtons() {
  svg.$("undo").onclick = store.undo;
  svg.$("redo").onclick = store.redo;
  svg.$("back").onclick = interaction.goBack;
  svg.$("checkBtn").onclick = store.checkModel;
  svg.$("libFilter").oninput = render.renderSide;
}

/** Load the model, open the first sheet and draw it. */
async function start() {
  await loadModel();
  openFirstSheet();
  render.render();
  statusbar.setStatus("ready");
  statusbar.showDefaultHint();
  store.checkModel(); // the server checks the whole model; problems appear under the sheet
}

/** Every model file, with its layout, from the server. */
async function loadModel() {
  const response = await fetch("/api/model");
  state.editor.sysmlPackages = (await response.json()).packages;
  store.markAllSysmlPackagesSaved(); // what was loaded is what is on disk
  model.indexSysmlDefinitions(); // name -> definition, for lookups
}

/** Open the first sheet and lay it out. */
function openFirstSheet() {
  if (modelHasNoSheets()) return;
  state.editor.sheet = chooseFirstSheet();
  layout.layOutSheet(state.editor.sheet);
}

function modelHasNoSheets() {
  return allSheets().length === 0;
}

/**
 * The first sheet to show: the one named in the page's address
 * (.../#Control), else the FPGA's sheet, else the first sheet by name.
 */
function chooseFirstSheet() {
  return sheetNamedInAddress() || fpgaSheet() || firstSheetByName();
}

/** The sheet named after # in the page's address, if there is one. */
function sheetNamedInAddress() {
  const name = decodeURIComponent(location.hash.slice(1));
  if (model.partDef(name)) return name;
  return null;
}

/** The FPGA's sheet, if the model has one. */
function fpgaSheet() {
  return allSheets().find(isFpga);
}

/** The first sheet in alphabetical order, if the model has any. */
function firstSheetByName() {
  return allSheets()[0];
}

/** Every part def that is drawn as a sheet, in alphabetical order. */
function allSheets() {
  const names = Object.keys(state.editor.sysmlDefinitions);
  return names.filter(isSheetPartDef).sort();
}

function isSheetPartDef(name) {
  const isPartDef = state.editor.sysmlDefinitions[name].coll === "partDefs";
  return isPartDef && model.isSheet(name);
}

function isFpga(name) {
  return ["Fpga", "FpgaPart"].includes(model.kindOf(name));
}
