// HA 2: the side panel: the sheets, the clocks and resets (netpanel.js), the
// library of part defs to drag onto a sheet, and the interfaces (port defs)
// to drag onto a port.
import * as interaction from "./interaction.js";
import * as model from "./model.js";
import * as netPanel from "./netpanel.js";
import * as state from "./state.js";
import * as svg from "./svg.js";

/** Redraw every section of the side panel. */
export function renderSide() {
  renderSheetList();
  renderLibrary();
  netPanel.renderNets();
  renderInterfaces();
}

// ------------------------------------------------------------------ sheets

/** Every sheet, grouped by package; the open one marked. */
function renderSheetList() {
  const list = svg.$("sheets");
  list.innerHTML = "";
  const byPackage = groupBy(model.sheetNames(), model.packageNameOf);
  for (const packageName of Object.keys(byPackage).sort()) {
    list.appendChild(groupHeading(packageName));
    for (const sheetName of byPackage[packageName])
      list.appendChild(sheetItem(sheetName));
  }
}

function sheetItem(sheetName) {
  const item = sideItem(sheetName, kindColor(model.kindOf(sheetName)));
  if (sheetName === state.editor.sheet) item.classList.add("cur");
  item.onclick = () => interaction.openSheet(sheetName);
  return item;
}

// ------------------------------------------------------------------ library

/** The part defs you can add an instance of, by kind, filtered by the box above. */
function renderLibrary() {
  const list = svg.$("library");
  list.innerHTML = "";
  const filter = svg.$("libFilter").value.toLowerCase();
  const matching = model
    .instantiablePartDefNames()
    .filter((name) => name.toLowerCase().includes(filter));
  const byKind = groupBy(matching, (name) => model.kindOf(name) || "other");
  for (const kind of Object.keys(byKind).sort()) {
    list.appendChild(groupHeading(kind));
    for (const name of byKind[kind]) list.appendChild(libraryItem(name, kind));
  }
}

function libraryItem(name, kind) {
  const item = sideItem(name, kindColor(kind));
  item.draggable = true;
  item.title =
    (model.partDef(name).doc || "") +
    "\nDrag onto a column to add an instance.";
  item.ondragstart = (event) =>
    event.dataTransfer.setData("text/x-partdef", name);
  return item;
}

// ------------------------------------------------------------------ interfaces

/** Every interface (port def), with its mirror role and signals as a tooltip. */
function renderInterfaces() {
  const list = svg.$("interfaces");
  list.innerHTML = "";
  for (const name of model.portDefNames())
    list.appendChild(interfaceItem(name));
}

function interfaceItem(name) {
  const mirrorOf = model.portDef(name).conjugateOf;
  const item = sideItem(name);
  if (mirrorOf) item.textContent += ` ↔ ${mirrorOf}`;
  item.draggable = true;
  item.title =
    (model.portDef(name).doc || "") +
    "\n" +
    signalSummary(name) +
    "\nDrag onto a port to set its interface.";
  item.ondragstart = (event) =>
    event.dataTransfer.setData("text/x-portdef", name);
  return item;
}

/**
 * An interface's signals with their directions from its own side
 * ("in clk, out data"). A mirror role (conjugateOf) has its base's signals,
 * directions swapped.
 */
function signalSummary(name) {
  const mirrorOf = model.portDef(name).conjugateOf;
  const base = mirrorOf ? model.portDef(mirrorOf) : model.portDef(name);
  if (!base) return "";
  const features = [...(base.attributes || []), ...(base.items || [])];
  const directed = features.filter((feature) => feature.direction);
  return directed
    .map((feature) => `${direction(feature, mirrorOf)} ${feature.name}`)
    .join(", ");
}

function direction(feature, mirrored) {
  if (!mirrored) return feature.direction;
  return { in: "out", out: "in", inout: "inout" }[feature.direction];
}

// ------------------------------------------------------------------ pieces

/** A side panel group heading. */
export function groupHeading(text) {
  const heading = document.createElement("div");
  heading.className = "group";
  heading.textContent = text;
  return heading;
}

/** A side panel item; with a colour, as its left border. */
export function sideItem(text, borderColor) {
  const item = document.createElement("div");
  item.className = "item";
  item.textContent = text;
  if (borderColor) item.style.borderLeftColor = borderColor;
  return item;
}

/** A kind's colour, or transparent for a def without a kind. */
export function kindColor(kind) {
  return state.KIND_COLORS[kind] || "transparent";
}

/** Names grouped by a key: {key: [names in their order]}. */
function groupBy(names, keyOf) {
  const groups = {};
  for (const name of names) {
    const key = keyOf(name);
    groups[key] = groups[key] || [];
    groups[key].push(name);
  }
  return groups;
}
