// HA 2: the right-click menus of the sheet itself: its edge (the sheet's own
// ports) and its columns (new parts).
//
// `place` is where on the sheet the click was: {sheet, side} on an edge,
// {sheet, column, y} in a column (y in the drawing's coordinates).
import * as descriptions from "./descriptions.js";
import * as dialogs from "./dialogs.js";
import * as edits from "./edits.js";
import * as interaction from "./interaction.js";
import * as menus from "./menus.js";
import * as model from "./model.js";
import * as nets from "./nets.js";
import * as partMenu from "./partmenu.js";
import * as state from "./state.js";

// ------------------------------------------------------------------ the edge

/** A right-click on the sheet's left or right edge: add a port of the sheet. */
export function edgeMenu(event, side) {
  event.preventDefault();
  const sheet = state.editor.sheet;
  const place = { sheet, side, y: interaction.svgPoint(event).y };
  const netPort = (label, net) => ({
    label,
    act: () => nets.addGlobalPort(sheet, ...net, side),
  });
  menus.menu(event.clientX, event.clientY, [
    {
      label: `Add a port to ${sheet} (${side} edge)`,
      act: () => askAndAddSheetPort(place),
    },
    netPort(`Add a clock input to ${sheet}…`, ["clock", "in", "clk"]),
    netPort(`Add a reset input to ${sheet}…`, ["reset", "in", "rst"]),
    netPort(`Add a SYSREF input to ${sheet}…`, ["sysref", "in", "sysref"]),
  ]);
}

function askAndAddSheetPort(place) {
  const { sheet, side, y } = place;
  const name = dialogs.askName(
    `New port of ${sheet}`,
    edits.uniquePortName(sheet, "port"),
  );
  if (!name) return;
  if (descriptions.portOf(sheet, name)) {
    alert(`${sheet} already has a port ${name}.`);
    return;
  }
  edits.newSheetPort(sheet, name, side, y);
}

// ------------------------------------------------------------------ a column

/** A right-click in a column: add a part there, or change the columns. */
export function columnMenu(event, column) {
  event.preventDefault();
  const sheet = state.editor.sheet;
  const place = { sheet, column, y: interaction.svgPoint(event).y };
  const position = { x: event.clientX, y: event.clientY };
  menus.menu(position.x, position.y, [
    { head: `Column ${column + 1}` },
    ...newPartEntries(place),
    {
      label: "Add an instance of a library part…",
      act: () => libraryMenu(position, place),
    },
    sheetDescriptionEntry(sheet),
    { sep: true },
    ...columnEntries(place),
  ]);
}

/** "Add Rtl…", "Add Subsystem…", ...: a new part def of that kind, and a part of it. */
function newPartEntries(place) {
  return partMenu.kindsAvailable().map((kind) => ({
    label: `Add ${kind}…`,
    act: () => addNewPart(place, kind),
  }));
}

function sheetDescriptionEntry(sheet) {
  const described = model.partDef(sheet) && model.partDef(sheet).doc;
  return {
    label: `Description of this sheet (${sheet})${described ? " ✓" : ""}…`,
    act: () => descriptions.editDoc(`Description of ${sheet}`, { def: sheet }),
  };
}

function columnEntries(place) {
  const { sheet, column } = place;
  return [
    {
      label: "Add column to the left",
      act: () => edits.insertColumn(sheet, column),
    },
    {
      label: "Add column to the right",
      act: () => edits.insertColumn(sheet, column + 1),
    },
    {
      label: "Remove this column",
      danger: true,
      act: () => edits.removeColumn(sheet, column),
    },
  ];
}

/** Add a part of an existing part def (a library part). */
function libraryMenu(position, place) {
  const entries = [{ head: "Add an instance of" }];
  for (const name of model.instantiablePartDefNames()) {
    if (name === place.sheet) continue;
    entries.push({
      label: `${name}  (${model.kindOf(name) || "part"})`,
      act: () => addInstance(place, name),
    });
  }
  menus.menu(position.x, position.y, entries);
}

// edits.addComponent's last argument says which of the two it is.
function addNewPart(place, kind) {
  edits.addComponent(place.sheet, place.column, place.y, kind, false);
}

function addInstance(place, defName) {
  edits.addComponent(place.sheet, place.column, place.y, defName, true);
}
