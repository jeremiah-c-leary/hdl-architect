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
import * as utilMod from "./util.js";
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
import { S } from "./state.js";
import { $, hint } from "./util.js";
import { isSheet, kindOf, partDef, rebuildIndex } from "./model.js";
import { settle } from "./layout.js";
import { check, redo, setStatus, undo } from "./store.js";
import { render, renderSide } from "./render.js";
import { goBack } from "./interaction.js";

// Every module's functions and state, by name: for the tests and the browser
// console (e.g. ha2.partDef('Control')). Not used by HA 2 itself.
window.ha2 = Object.assign(
  {},
  stateMod,
  utilMod,
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

$("undo").onclick = undo;
$("redo").onclick = redo;
$("back").onclick = goBack;
$("checkBtn").onclick = check;
$("libFilter").oninput = renderSide;

// ------------------------------------------------------------------ start
(async function start() {
  const r = await fetch("/api/model");
  S.pkgs = (await r.json()).packages;
  for (const p of S.pkgs)
    S.saved[p.file] = {
      m: JSON.stringify(p.model),
      l: JSON.stringify(p.layout || null),
    };
  rebuildIndex();
  const want = decodeURIComponent(location.hash.slice(1));
  const sheets = Object.keys(S.defs)
    .filter((n) => S.defs[n].coll === "partDefs" && isSheet(n))
    .sort();
  const first = partDef(want)
    ? want
    : sheets.find((n) => ["Fpga", "FpgaPart"].includes(kindOf(n))) ||
      sheets[0] ||
      null;
  if (first) {
    S.sheet = first;
    settle(first);
  }
  render();
  setStatus("ready");
  hint();
  check();
})();
