// HA 2: The context menu, every right-click menu, and the text dialogs.
import { estimateItems } from "./estimates.js";
import { KIND_COLORS, editor } from "./state.js";
import { $, trunc } from "./svg.js";
import { showDefaultHint } from "./statusbar.js";
import { askName, askText } from "./dialogs.js";
import {
  definition,
  instantiablePartDefNames,
  isDefined,
  kindOf,
  packageNameOf,
  partDef,
  partType,
  portDef,
  portDefNames,
  portsOfDef,
} from "./model.js";
import { addGlobalPort, pairMenu, pairable, pairedClock } from "./nets.js";
import { applyOp } from "./store.js";
import {
  addComponent,
  deletePart,
  deletePort,
  flipComponent,
  flipPorts,
  insertColumn,
  isPicked,
  moveColumn,
  newPort,
  newSheetPort,
  removeColumn,
  renameDef,
  renamePart,
  renamePort,
  setKind,
  setPartDef,
  setPortType,
  setPortsType,
  togglePick,
  uniquePortName,
} from "./edits.js";
import { render } from "./render.js";
import { openSheet, svgPoint } from "./interaction.js";

// ------------------------------------------------------------------ context menu
export function menu(x, y, items) {
  const m = $("menu");
  m.innerHTML = "";
  for (const it of items) {
    if (!it) continue;
    const d = document.createElement("div");
    if (it.sep) d.className = "sep";
    else if (it.head) {
      d.className = "hd";
      d.textContent = it.head;
    } else {
      d.className = "mi" + (it.danger ? " danger" : "");
      d.textContent = it.label;
      d.onclick = () => {
        hideMenu();
        it.act();
      };
    }
    m.appendChild(d);
  }
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 8) + "px";
  m.style.top = Math.min(y, innerHeight - r.height - 8) + "px";
  m.style.maxHeight = innerHeight - 16 + "px";
  m.style.overflow = "auto";
}
export function hideMenu() {
  $("menu").hidden = true;
}
export function portDefMenu(x, y, P, port, cur) {
  const groups = {};
  for (const n of portDefNames())
    (groups[packageNameOf(n)] = groups[packageNameOf(n)] || []).push(n);
  const items = [
    { head: `Interface of ${port}` },
    cur
      ? { label: "(none: untyped)", act: () => setPortType(P, port, null) }
      : null,
  ];
  for (const g of Object.keys(groups).sort()) {
    items.push({ head: g });
    for (const n of groups[g])
      items.push({
        label:
          (n === cur ? "✓ " : "") +
          n +
          (portDef(n).conjugateOf
            ? `  (mirror of ${portDef(n).conjugateOf})`
            : ""),
        act: () => setPortType(P, port, n),
      });
  }
  menu(x, y, items);
}
export function libraryMenu(x, y, D, col, yy) {
  const items = [{ head: "Add an instance of" }];
  for (const n of instantiablePartDefNames()) {
    if (n !== D)
      items.push({
        label: `${n}  (${kindOf(n) || "part"})`,
        act: () => addComponent(D, col, yy, n, true),
      });
  }
  menu(x, y, items);
}
export function kindsAvailable() {
  return Object.keys(KIND_COLORS).filter(
    (k) => partDef(k) && k !== "FpgaComponent" && k !== "Container",
  );
}
export function edgeMenu(ev, side) {
  ev.preventDefault();
  const D = editor.sheet,
    y = svgPoint(ev).y;
  menu(ev.clientX, ev.clientY, [
    {
      label: `Add a port to ${D} (${side} edge)`,
      act: () => {
        const name = askName(`New port of ${D}`, uniquePortName(D, "port"));
        if (!name) return;
        if (portsOfDef(D).some((p) => p.name === name)) {
          alert(`${D} already has a port ${name}.`);
          return;
        }
        newSheetPort(D, name, side, y);
      },
    },
    {
      label: `Add a clock input to ${D}…`,
      act: () => addGlobalPort(D, "clock", "in", "clk", side),
    },
    {
      label: `Add a reset input to ${D}…`,
      act: () => addGlobalPort(D, "reset", "in", "rst", side),
    },
    {
      label: `Add a SYSREF input to ${D}…`,
      act: () => addGlobalPort(D, "sysref", "in", "sysref", side),
    },
  ]);
}
export function colMenu(ev, col) {
  ev.preventDefault();
  const D = editor.sheet,
    y = svgPoint(ev).y;
  const items = [{ head: `Column ${col + 1}` }];
  for (const k of kindsAvailable())
    items.push({
      label: `Add ${k}…`,
      act: () => addComponent(D, col, y, k, false),
    });
  items.push({
    label: "Add an instance of a library part…",
    act: () => libraryMenu(ev.clientX, ev.clientY, D, col, y),
  });
  items.push({
    label: `Description of this sheet (${D})${partDef(D) && partDef(D).doc ? " ✓" : ""}…`,
    act: () => editDoc(`Description of ${D}`, { def: D }),
  });
  items.push(
    { sep: true },
    { label: "Add column to the left", act: () => insertColumn(D, col) },
    { label: "Add column to the right", act: () => insertColumn(D, col + 1) },
    {
      label: "Remove this column",
      danger: true,
      act: () => removeColumn(D, col),
    },
  );
  menu(ev.clientX, ev.clientY, items);
}
/**
 * The right-click menu of a component (a part on a sheet). `component` holds
 * what every item needs: {sheet, part, def}: the sheet it is on, its part
 * name, and its part def.
 */
export function compMenu(ev, D, name) {
  const component = { sheet: D, part: name, def: partType(D, name) };
  const position = { x: ev.clientX, y: ev.clientY };
  menu(position.x, position.y, [
    { head: `${component.part} : ${component.def}` },
    ...arrangeItems(component),
    ...addPortItems(component),
    { sep: true },
    ...definitionItems(component, position),
    ...estimateItems(component),
    { sep: true },
    {
      label: "Delete",
      danger: true,
      act: () => deletePart(component.sheet, component.part),
    },
  ]);
}

/** Open its sheet, and move it on this one. */
function arrangeItems(component) {
  const { sheet, part, def } = component;
  return [
    { label: "Open its sheet", act: () => openSheet(def) },
    {
      label: "Flip: swap its ports' sides  (F)",
      act: () => flipComponent(sheet, part),
    },
    {
      label: "Move one column left  (Ctrl+←)",
      act: () => moveColumn(sheet, part, -1),
    },
    {
      label: "Move one column right (Ctrl+→)",
      act: () => moveColumn(sheet, part, +1),
    },
  ];
}

/** Add a clock, reset or SYSREF port, or any port, to its part def. */
function addPortItems(component) {
  const def = component.def;
  const globalPort = (label, category, portDirection, name) => ({
    label,
    act: () => addGlobalPort(def, category, portDirection, name),
  });
  return [
    globalPort("Add a clock input…", "clock", "in", "clk"),
    globalPort("Add a reset input…", "reset", "in", "rst"),
    globalPort("Add a clock output…", "clock", "out", "clk_out"),
    globalPort("Add a reset output…", "reset", "out", "rst_out"),
    globalPort("Add a SYSREF input…", "sysref", "in", "sysref"),
    { label: "Add a port…", act: () => askAndAddPort(def) },
  ];
}

function askAndAddPort(def) {
  const name = askName(`New port of ${def}`, uniquePortName(def, "port"));
  if (!name) return;
  if (portsOfDef(def).some((port) => port.name === name)) {
    alert(`${def} already has a port ${name}.`);
    return;
  }
  newPort(def, name, "left");
}

/** Its description, names, kind and definition. */
function definitionItems(component, position) {
  const { sheet, part, def } = component;
  const hasDoc = partDef(def) && partDef(def).doc;
  return [
    {
      label: `Description of ${def}${hasDoc ? " ✓" : ""}…`,
      act: () => editDoc(`Description of ${def} (every instance)`, { def }),
    },
    { label: "Rename instance…", act: () => askAndRenamePart(sheet, part) },
    {
      label: `Rename definition ${def}…`,
      act: () => askAndRenameDef(def),
    },
    {
      label: `Kind: ${kindOf(def) || "none"}…`,
      act: () => kindMenu(def, position),
    },
    {
      label: "Change definition…",
      act: () => changeDefinitionMenu(component, position),
    },
  ];
}

function askAndRenamePart(sheet, part) {
  const name = askName("Instance name", part);
  if (name && name !== part) renamePart(sheet, part, name);
}

function askAndRenameDef(def) {
  const name = askName("Definition name", def);
  if (!name || name === def) return;
  if (isDefined(name)) alert(`${name} already exists.`);
  else renameDef(def, name);
}

/** Choose the part def's kind (Rtl, Subsystem, ...). */
function kindMenu(def, position) {
  const items = [{ head: `${def} is a…` }];
  for (const kind of kindsAvailable())
    items.push({
      label: (kind === kindOf(def) ? "✓ " : "") + kind,
      act: () => setKind(def, kind),
    });
  if (items.length === 1)
    items.push({
      head: "No kinds in the model (part defs named Rtl, VendorIp, ...)",
    });
  menu(position.x, position.y, items);
}

/** Make the part an instance of another part def. */
function changeDefinitionMenu(component, position) {
  const { sheet, part, def } = component;
  const items = [{ head: `Type of ${part}` }];
  for (const name of instantiablePartDefNames())
    if (name !== sheet)
      items.push({
        label: (name === def ? "✓ " : "") + name,
        act: () => setPartDef(sheet, part, name),
      });
  menu(position.x, position.y, items);
}
// ------------------------------------------------------------------ descriptions (SysML `doc`)
// A description (SysML doc) and a port's readable name are model operations
// (core.ops.set_doc, set_port_name, via the server).
export async function editDoc(title, target, hintText) {
  // target: { def } or { def, port }
  const obj = target.port
    ? portsOfDef(target.def).find((p) => p.name === target.port)
    : definition(target.def);
  if (!obj) return;
  const text = await askText(title, obj.doc, hintText);
  if (text === null) return;
  const t = text
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim();
  if ((obj.doc || "") === t) return;
  return applyOp("set_doc", {
    def: target.def,
    port: target.port || null,
    text: t,
  });
}
// A port's readable SysML name ("Processing CSR"); its identifier stays `name`
// (in the file: name = the readable text, shortName = the identifier).
export async function editLabel(P, name) {
  const port = portsOfDef(P).find((p) => p.name === name);
  if (!port) return;
  const v = prompt(
    `Name of port ${P}.${name}: a readable name for the interface, e.g. "Processing CSR". ` +
      "It heads the port in the generated VHDL and the documents; the VHDL name stays " +
      name +
      ". Empty removes it.",
    port.label || "",
  );
  if (v === null) return;
  const t = v.replace(/['\\\r\n]/g, "").trim();
  if ((port.label || "") === t) return;
  return applyOp("set_port_name", { def: P, port: name, name: t || null });
}
export function portMenu(ev, P, name, isEdge) {
  const port = portsOfDef(P).find((p) => p.name === name);
  if (editor.picked.length > 1 && isPicked(P, name)) {
    const n = editor.picked.length;
    menu(ev.clientX, ev.clientY, [
      { head: `${n} ports picked` },
      {
        label: `Move the ${n} ports to the other side  (F)`,
        act: () => {
          const l = editor.picked;
          editor.picked = [];
          flipPorts(l);
        },
      },
      {
        label: "Set their interface…",
        act: () => {
          const items = [{ head: `Interface of ${n} ports` }];
          for (const t of portDefNames())
            items.push({
              label: t,
              act: () => setPortsType(editor.picked, t),
            });
          menu(ev.clientX, ev.clientY, items);
        },
      },
      {
        label: "Clear the selection  (Esc)",
        act: () => {
          editor.picked = [];
          render();
          showDefaultHint();
        },
      },
    ]);
    return;
  }
  menu(ev.clientX, ev.clientY, [
    { head: `${P}.${name}${port.type ? " : " + port.type : ""}` },
    {
      label: "Set interface…",
      act: () => portDefMenu(ev.clientX, ev.clientY, P, name, port.type),
    },
    pairable(port)
      ? {
          label: `Sampled by: ${pairedClock(port) || "(no clock)"}…`,
          act: () => pairMenu(ev, P, name),
        }
      : null,
    {
      label: "Move to the other side",
      act: () => flipPorts([{ P, port: name, isEdge }]),
    },
    {
      label: "Pick it (Shift+click) to move several",
      act: () => togglePick(P, name, isEdge),
    },
    {
      label: `Name${port.label ? ": " + trunc(port.label, 28) : ""}…`,
      act: () => editLabel(P, name),
    },
    {
      label: `Description${port.doc ? " ✓" : ""}…`,
      act: () =>
        editDoc(`Description of port ${P}.${name}`, { def: P, port: name }),
    },
    {
      label: "Rename (VHDL name)…",
      act: () => {
        const n = askName("Port name", name);
        if (n && n !== name) {
          if (portsOfDef(P).some((p) => p.name === n))
            alert(`${P} already has ${n}.`);
          else renamePort(P, name, n);
        }
      },
    },
    { sep: true },
    {
      label: `Delete (from ${P}, every instance)`,
      danger: true,
      act: () => deletePort(P, name),
    },
  ]);
}
