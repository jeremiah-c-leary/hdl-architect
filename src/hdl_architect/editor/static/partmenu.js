// HA 2: the right-click menu of a part on a sheet (a component).
//
// Each group of entries is made by its own function from `component`:
// {sheet, part, def}: the sheet it is on, its part name, and its part def.
import * as descriptions from "./descriptions.js";
import * as dialogs from "./dialogs.js";
import * as edits from "./edits.js";
import * as estimates from "./estimates.js";
import * as interaction from "./interaction.js";
import * as menus from "./menus.js";
import * as model from "./model.js";
import * as nets from "./nets.js";
import * as state from "./state.js";

/** Kinds that are not offered: a part def is never just one of these. */
const HIDDEN_KINDS = new Set(["FpgaComponent", "Container"]);

export function partMenu(event, sheet, part) {
  const component = { sheet, part, def: model.partType(sheet, part) };
  const position = { x: event.clientX, y: event.clientY };
  menus.menu(position.x, position.y, [
    { head: `${component.part} : ${component.def}` },
    ...arrangeEntries(component),
    ...addPortEntries(component),
    { sep: true },
    ...definitionEntries(component, position),
    ...estimates.estimateItems(component),
    { sep: true },
    deleteEntry(component),
  ]);
}

/** The kinds of part def the model has (Rtl, Subsystem, ...), to choose from. */
export function kindsAvailable() {
  return Object.keys(state.KIND_COLORS).filter(
    (kind) => model.partDef(kind) && !HIDDEN_KINDS.has(kind),
  );
}

// ------------------------------------------------------------------ the groups

/** Open its sheet, and move it on this one. */
function arrangeEntries(component) {
  const { sheet, part, def } = component;
  return [
    { label: "Open its sheet", act: () => interaction.openSheet(def) },
    {
      label: "Flip: swap its ports' sides  (F)",
      act: () => edits.flipComponent(sheet, part),
    },
    {
      label: "Move one column left  (Ctrl+←)",
      act: () => edits.moveColumn(sheet, part, -1),
    },
    {
      label: "Move one column right (Ctrl+→)",
      act: () => edits.moveColumn(sheet, part, +1),
    },
  ];
}

/** Add a clock, reset or SYSREF port, or any port, to its part def. */
function addPortEntries(component) {
  const def = component.def;
  const netPort = (label, net) => ({
    label,
    act: () => nets.addGlobalPort(def, ...net),
  });
  return [
    netPort("Add a clock input…", ["clock", "in", "clk"]),
    netPort("Add a reset input…", ["reset", "in", "rst"]),
    netPort("Add a clock output…", ["clock", "out", "clk_out"]),
    netPort("Add a reset output…", ["reset", "out", "rst_out"]),
    netPort("Add a SYSREF input…", ["sysref", "in", "sysref"]),
    { label: "Add a port…", act: () => askAndAddPort(def) },
  ];
}

/** Its description, names, kind and definition. */
function definitionEntries(component, position) {
  const def = component.def;
  return [
    descriptionEntry(def),
    ...renameEntries(component),
    {
      label: `Kind: ${model.kindOf(def) || "none"}…`,
      act: () => kindMenu(def, position),
    },
    {
      label: "Change definition…",
      act: () => changeDefinitionMenu(component, position),
    },
  ];
}

function renameEntries(component) {
  const { sheet, part, def } = component;
  return [
    {
      label: "Rename instance…",
      act: () => askAndRenamePart(sheet, part),
    },
    {
      label: `Rename definition ${def}…`,
      act: () => askAndRenameDef(def),
    },
  ];
}

function descriptionEntry(def) {
  const described = model.partDef(def) && model.partDef(def).doc;
  const title = `Description of ${def} (every instance)`;
  return {
    label: `Description of ${def}${described ? " ✓" : ""}…`,
    act: () => descriptions.editDoc(title, { def }),
  };
}

function deleteEntry(component) {
  return {
    label: "Delete",
    danger: true,
    act: () => edits.deletePart(component.sheet, component.part),
  };
}

// ------------------------------------------------------------------ what they ask

function askAndAddPort(def) {
  const name = dialogs.askName(
    `New port of ${def}`,
    edits.uniquePortName(def, "port"),
  );
  if (!name) return;
  if (descriptions.portOf(def, name)) {
    alert(`${def} already has a port ${name}.`);
    return;
  }
  edits.newPort(def, name, "left");
}

function askAndRenamePart(sheet, part) {
  const name = dialogs.askName("Instance name", part);
  if (name && name !== part) edits.renamePart(sheet, part, name);
}

function askAndRenameDef(def) {
  const name = dialogs.askName("Definition name", def);
  if (!name || name === def) return;
  if (model.isDefined(name)) alert(`${name} already exists.`);
  else edits.renameDef(def, name);
}

/** Choose the part def's kind (Rtl, Subsystem, ...). */
function kindMenu(def, position) {
  const entries = [{ head: `${def} is a…` }];
  for (const kind of kindsAvailable())
    entries.push({
      label: ticked(kind, kind === model.kindOf(def)),
      act: () => edits.setKind(def, kind),
    });
  if (entries.length === 1)
    entries.push({
      head: "No kinds in the model (part defs named Rtl, VendorIp, ...)",
    });
  menus.menu(position.x, position.y, entries);
}

/** Make the part an instance of another part def. */
function changeDefinitionMenu(component, position) {
  const { sheet, part, def } = component;
  const entries = [{ head: `Type of ${part}` }];
  for (const name of model.instantiablePartDefNames()) {
    if (name === sheet) continue;
    entries.push({
      label: ticked(name, name === def),
      act: () => edits.setPartDef(sheet, part, name),
    });
  }
  menus.menu(position.x, position.y, entries);
}

/** "✓ name" for the current choice. */
export function ticked(name, isCurrent) {
  return isCurrent ? `✓ ${name}` : name;
}
