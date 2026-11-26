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
import * as estimates from "./estimates.js";
import * as resourceBar from "./resourcebar.js";
import * as resourceBanner from "./resourcebanner.js";
import * as resourceView from "./resourceview.js";
import * as deviceView from "./deviceview.js";

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
  estimates,
  resourceBar,
  resourceBanner,
  resourceView,
  deviceView,
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
  estimates.startResources();
}

/** Every model file, with its layout, from the server. */
async function loadModel() {
  const response = await fetch("/api/model");
  model.load((await response.json()).packages);
  store.markAllSysmlPackagesSaved(); // what was loaded is what is on disk
}

/** Open the first sheet and lay it out. */
function openFirstSheet() {
  if (model.hasNoSheets()) return;
  state.editor.sheet = chooseFirstSheet();
  layout.layOutSheet(state.editor.sheet);
}

/**
 * The first sheet to show: the one named in the page's address
 * (.../#Control), else the FPGA's sheet, else the first sheet by name.
 */
function chooseFirstSheet() {
  return sheetNamedInAddress() || model.fpgaSheet() || model.sheetNames()[0];
}

/** The sheet named in the page's address, if there is one. */
function sheetNamedInAddress() {
  const name = nameInAddress();
  if (model.partDef(name)) return name;
  return null;
}

/**
 * The name after # in the page's address: ".../#Control" gives "Control".
 * location.hash is the "#Control" part; the address encodes some characters
 * (a space is "%20"), and decodeURIComponent turns them back.
 */
function nameInAddress() {
  const withoutHash = location.hash.slice(1);
  return decodeURIComponent(withoutHash);
}
