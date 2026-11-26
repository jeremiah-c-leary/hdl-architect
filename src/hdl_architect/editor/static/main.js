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
import * as stateMod from "./state.js";
import * as svgMod from "./svg.js";
import * as dialogsMod from "./dialogs.js";
import * as statusbarMod from "./statusbar.js";
import * as modelMod from "./model.js";
import * as netsMod from "./nets.js";
import * as layoutMod from "./layout.js";
import * as storeMod from "./store.js";
import * as editsMod from "./edits.js";
import * as menusMod from "./menus.js";
import * as renderMod from "./render.js";
import * as interactionMod from "./interaction.js";
import * as clocktreeMod from "./clocktree.js";
import * as exportMod from "./export.js";
import { editor } from "./state.js";
import { $ } from "./svg.js";
import { setStatus, showDefaultHint } from "./statusbar.js";
import { isSheet, kindOf, partDef, indexSysmlDefinitions } from "./model.js";
import { layOutSheet } from "./layout.js";
import { checkModel, markAllSysmlPackagesSaved, redo, undo } from "./store.js";
import { render, renderSide } from "./render.js";
import { goBack } from "./interaction.js";

// Every module's functions and state, by name: for the tests and the browser
// console (e.g. ha2.partDef('Control')). Not used by HA 2 itself.
window.ha2 = Object.assign(
  {},
  stateMod,
  svgMod,
  dialogsMod,
  statusbarMod,
  modelMod,
  netsMod,
  layoutMod,
  storeMod,
  editsMod,
  menusMod,
  renderMod,
  interactionMod,
  clocktreeMod,
  exportMod,
);

// ------------------------------------------------------------------ start
wireButtons();
start();

/** The top bar's buttons and the library filter. */
function wireButtons() {
  $("undo").onclick = undo;
  $("redo").onclick = redo;
  $("back").onclick = goBack;
  $("checkBtn").onclick = checkModel;
  $("libFilter").oninput = renderSide;
}

/** Load the model, open the first sheet and draw it. */
async function start() {
  await loadModel();
  openFirstSheet();
  render();
  setStatus("ready");
  showDefaultHint();
  checkModel(); // the server checks the whole model; problems appear under the sheet
}

/** Every model file, with its layout, from the server. */
async function loadModel() {
  const response = await fetch("/api/model");
  editor.sysmlPackages = (await response.json()).packages;
  markAllSysmlPackagesSaved(); // what was loaded is what is on disk
  indexSysmlDefinitions(); // name -> definition, for lookups
}

/** Open the first sheet and lay it out. */
function openFirstSheet() {
  if (modelHasNoSheets()) return;
  editor.sheet = chooseFirstSheet();
  layOutSheet(editor.sheet);
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
  if (partDef(name)) return name;
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
  const names = Object.keys(editor.sysmlDefinitions);
  return names.filter(isSheetPartDef).sort();
}

function isSheetPartDef(name) {
  const isPartDef = editor.sysmlDefinitions[name].coll === "partDefs";
  return isPartDef && isSheet(name);
}

function isFpga(name) {
  return ["Fpga", "FpgaPart"].includes(kindOf(name));
}
