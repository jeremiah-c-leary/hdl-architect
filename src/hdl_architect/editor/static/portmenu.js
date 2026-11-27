// HA 2: the right-click menu of a port, on a part or on the sheet's edge.
//
// `port` is {def, name, isEdge}: the part def (or sheet) it belongs to, its
// name, and whether it is the sheet's own port (drawn on the edge).
import * as descriptions from "./descriptions.js";
import * as dialogs from "./dialogs.js";
import * as edits from "./edits.js";
import * as menus from "./menus.js";
import * as model from "./model.js";
import * as nets from "./nets.js";
import * as partMenu from "./partmenu.js";
import * as render from "./render.js";
import * as state from "./state.js";
import * as statusbar from "./statusbar.js";
import * as svg from "./svg.js";

/** Longest port name shown in the menu before it is cut short. */
const LABEL_LENGTH = 28;

/** The menu of a port on the sheet's edge. */
export function edgePortMenu(event, sheetName, name) {
  portMenu(event, { def: sheetName, name, isEdge: true });
}

/** The menu of a port of a component. */
export function partPortMenu(event, defName, name) {
  portMenu(event, { def: defName, name, isEdge: false });
}

/** One port's menu; several picked ports (Shift+click) have their own. */
export function portMenu(event, port) {
  const position = { x: event.clientX, y: event.clientY };
  if (isOneOfSeveralPicked(port)) {
    pickedPortsMenu(position);
    return;
  }
  const found = descriptions.portOf(port.def, port.name);
  menus.menu(position.x, position.y, [
    { head: portHeading(port, found) },
    {
      label: "Set interface…",
      act: () => portDefMenu(position, { ...port, type: found.type }),
    },
    clockEntry(event, port, found),
    ...placeEntries(port),
    ...nameEntries(port, found),
    { sep: true },
    deleteEntry(port),
  ]);
}

function deleteEntry(port) {
  return {
    label: `Delete (from ${port.def}, every instance)`,
    danger: true,
    act: () => edits.deletePort(port.def, port.name),
  };
}

function isOneOfSeveralPicked(port) {
  return state.editor.picked.length > 1 && edits.isPicked(port.def, port.name);
}

function portHeading(port, found) {
  const typed = found.type ? ` : ${found.type}` : "";
  return `${port.def}.${port.name}${typed}`;
}

/** "Sampled by: clk…", for a port a clock samples (not a clock or reset). */
function clockEntry(event, port, found) {
  if (!nets.pairable(found)) return null;
  return {
    label: `Sampled by: ${nets.pairedClock(found) || "(no clock)"}…`,
    act: () => nets.pairMenu(event, port.def, port.name),
  };
}

/** Move it to the other side, or pick it to move several. */
function placeEntries(port) {
  const { def, name, isEdge } = port;
  return [
    {
      label: "Move to the other side",
      act: () => edits.flipPorts([{ P: def, port: name, isEdge }]),
    },
    {
      label: "Pick it (Shift+click) to move several",
      act: () => edits.togglePick(def, name, isEdge),
    },
  ];
}

/** Its readable name, description and VHDL name. */
function nameEntries(port, found) {
  const { def, name } = port;
  const label = found.label ? `: ${svg.trunc(found.label, LABEL_LENGTH)}` : "";
  const title = `Description of port ${def}.${name}`;
  return [
    {
      label: `Name${label}…`,
      act: () => descriptions.editLabel(def, name),
    },
    {
      label: `Description${found.doc ? " ✓" : ""}…`,
      act: () => descriptions.editDoc(title, { def, port: name }),
    },
    { label: "Rename (VHDL name)…", act: () => askAndRenamePort(port) },
  ];
}

function askAndRenamePort(port) {
  const { def, name } = port;
  const newName = dialogs.askName("Port name", name);
  if (!newName || newName === name) return;
  if (descriptions.portOf(def, newName))
    alert(`${def} already has ${newName}.`);
  else edits.renamePort(def, name, newName);
}

// ------------------------------------------------------------------ its interface

/** Choose the port's port def (its interface), grouped by package. */
export function portDefMenu(position, port) {
  const entries = [{ head: `Interface of ${port.name}` }];
  if (port.type)
    entries.push({
      label: "(none: untyped)",
      act: () => edits.setPortType(port.def, port.name, null),
    });
  for (const [packageName, names] of portDefsByPackage()) {
    entries.push({ head: packageName });
    for (const name of names) entries.push(portDefEntry(port, name));
  }
  menus.menu(position.x, position.y, entries);
}

/** [package, port def names] for every package, sorted by package. */
function portDefsByPackage() {
  const groups = new Map();
  for (const name of model.portDefNames()) {
    const packageName = model.packageNameOf(name);
    if (!groups.has(packageName)) groups.set(packageName, []);
    groups.get(packageName).push(name);
  }
  const sorted = [...groups.keys()].sort();
  return sorted.map((packageName) => [packageName, groups.get(packageName)]);
}

function portDefEntry(port, name) {
  const mirrored = model.portDef(name).conjugateOf;
  const mirror = mirrored ? `  (mirror of ${mirrored})` : "";
  return {
    label: partMenu.ticked(name, name === port.type) + mirror,
    act: () => edits.setPortType(port.def, port.name, name),
  };
}

// ------------------------------------------------------------------ several ports

/** Several ports picked with Shift+click: move them, or set their interface. */
function pickedPortsMenu(position) {
  const count = state.editor.picked.length;
  menus.menu(position.x, position.y, [
    { head: `${count} ports picked` },
    {
      label: `Move the ${count} ports to the other side  (F)`,
      act: flipPicked,
    },
    {
      label: "Set their interface…",
      act: () => pickedPortDefMenu(position, count),
    },
    { label: "Clear the selection  (Esc)", act: clearPicked },
  ]);
}

function flipPicked() {
  const picked = state.editor.picked;
  state.editor.picked = [];
  edits.flipPorts(picked);
}

function pickedPortDefMenu(position, count) {
  const entries = [{ head: `Interface of ${count} ports` }];
  for (const name of model.portDefNames())
    entries.push({
      label: name,
      act: () => edits.setPortsType(state.editor.picked, name),
    });
  menus.menu(position.x, position.y, entries);
}

function clearPicked() {
  state.editor.picked = [];
  render.render();
  statusbar.showDefaultHint();
}
