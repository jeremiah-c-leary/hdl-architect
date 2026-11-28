// HA 2: the address map's dialogs (decision 14).
//
// - Memory map root…: a manager port's map name and the address its
//   manager sees the map at (set_root). It is set on the part def's port,
//   so every instance is a root.
// - Memory map windows…: one row per manager port of a crossbar part, each
//   with its window's base (an offset from the crossbar's own base) and size
//   (set_windows, all rows at once). Problems are shown as you type, and Save
//   waits until there are none.
//
// Both are opened from the sheet's right-click menus and from the memory map
// view; numbers are typed as 0x4000_1000, 4096, 4K or 4 KiB.
import * as addresses from "./addresses.js";
import * as dom from "./dom.js";
import * as model from "./model.js";
import * as store from "./store.js";

/** A map name becomes a SystemRDL addrmap name (as core.address_ops checks). */
const MAP_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

// ------------------------------------------------------------------ the root

/** Ask for a root's name and base, and set it (or remove it). */
export async function editRoot(defName, portName) {
  const root = { defName, portName, current: currentRoot(defName, portName) };
  root.fields = rootFields(root);
  const answer = await askInDialog(rootDialog(root));
  if (answer === "remove") return removeRoot(root);
  if (answer !== "ok") return null;
  return store.applyOp("set_root", {
    def: defName,
    port: portName,
    name: root.fields.name.value.trim(),
    base: addresses.parseNumber(root.fields.base.value),
  });
}

function currentRoot(defName, portName) {
  const port = model
    .portsOfDef(defName)
    .find((candidate) => candidate.name === portName);
  return addresses.rootOf(port);
}

function removeRoot(root) {
  return store.applyOp("set_root", { def: root.defName, port: root.portName });
}

function rootFields(root) {
  const current = root.current;
  const name = current ? current.map_name : root.portName;
  const base = addresses.addressText(current ? current.base || 0 : 0);
  return {
    name: dom.input("map name", name),
    base: dom.input("0x4000_0000", base),
  };
}

function rootDialog(root) {
  const { defName, portName, fields } = root;
  const problem = dom.element("div", "mm-dlg-problem");
  const check = () => showProblems(problem, rootProblems(fields));
  fields.name.oninput = check;
  fields.base.oninput = check;
  return {
    title: `Memory map root: ${defName}.${portName}`,
    hint: `Sets ${defName}.${portName}, so every instance of ${defName} is this map's root. The base is the address the manager sees the map at.`,
    body: [
      labelled("Name", fields.name),
      labelled("Base", fields.base),
      problem,
    ],
    extraButtons: root.current ? [["remove", "Remove root"]] : [],
    canSave: () => rootProblems(fields).length === 0,
    focus: fields.name,
  };
}

function rootProblems(fields) {
  const problems = [];
  if (!MAP_NAME_RE.test(fields.name.value.trim()))
    problems.push("The name: a letter, then letters, digits and underscores.");
  if (addresses.parseNumber(fields.base.value) === null)
    problems.push("The base: a number, such as 0x4000_0000.");
  return problems;
}

// ------------------------------------------------------------------ the windows

/**
 * Ask for the windows of crossbar part `part` on sheet `sheet`, and set them.
 * `focusPort` (optional): the manager port whose base field gets the cursor.
 */
export async function editWindows(sheet, part, focusPort) {
  await addresses.fetchMaps(); // the crossbar's own base, for the absolute column
  const crossbar = addresses.crossbarBlock(sheet, part);
  const rows = windowRows(sheet, part);
  const context = { sheet, part, rows, crossbar, focusPort };
  if ((await askInDialog(windowsDialog(context))) !== "ok") return null;
  const windows = changedWindows(rows);
  if (!windows.length) return null;
  return store.applyOp("set_windows", { sheet, windows });
}

/**
 * One row per manager port of the crossbar: {port, ends, reaches, window,
 * fields} for a port connected on this sheet; {port, note} for one that is
 * not (bound to the sheet's own port, or not wired).
 */
function windowRows(sheet, part) {
  const defName = model.partType(sheet, part);
  return addresses
    .managerPorts(defName)
    .map((port) => windowRow(sheet, `${part}.${port.name}`, port.name));
}

function windowRow(sheet, end, portName) {
  const definition = model.partDef(sheet);
  const connection = wireWith(definition.connections, end);
  if (connection) return connectedRow(portName, end, connection);
  const binding = wireWith(definition.bindings, end);
  if (binding)
    return {
      port: portName,
      note: `bound to ${sheet}'s port ${otherEnd(binding, end)}: its window is set where that port is connected`,
    };
  return { port: portName, note: "(not connected)" };
}

function wireWith(wires, end) {
  return (wires || []).find((wire) => wire.ends.includes(end));
}

function connectedRow(portName, end, connection) {
  const window = addresses.windowOf(connection);
  const shownBase = window ? addresses.addressText(window.base || 0) : "";
  const shownSize = window ? addresses.sizeText(window.size || 0) : "";
  return {
    port: portName,
    ends: connection.ends,
    reaches: otherEnd(connection, end),
    window,
    fields: {
      base: dom.input("offset", shownBase),
      size: dom.input("size", shownSize),
    },
  };
}

function otherEnd(wire, end) {
  return wire.ends[0] === end ? wire.ends[1] : wire.ends[0];
}

function editableRows(rows) {
  return rows.filter((row) => row.fields);
}

function windowsDialog(context) {
  const { sheet, part, rows, crossbar } = context;
  const problem = dom.element("div", "mm-dlg-problem");
  const check = () => {
    refreshAbsolutes(rows, crossbar);
    showProblems(problem, windowProblems(rows, crossbar));
  };
  watchFields(rows, check);
  return {
    title: `Memory map windows: ${part} (${model.partType(sheet, part)})`,
    hint: windowsHint(part, crossbar),
    body: [windowsTable(rows, crossbar), problem],
    extraButtons: [],
    canSave: () => windowProblems(rows, crossbar).length === 0,
    focus: focusField(context),
  };
}

/** Check as the user types, and once when the dialog opens. */
function watchFields(rows, check) {
  for (const row of editableRows(rows)) {
    row.fields.base.oninput = check;
    row.fields.size.oninput = check;
  }
  setTimeout(check, 0);
}

function windowsHint(part, crossbar) {
  const base = crossbar ? ` (${addresses.addressText(crossbar.base)})` : "";
  return `Each manager port's window. The base is an offset from ${part}'s own base${base}. Empty base and size: no window.`;
}

/** The base field of the port asked for, else of the first connected port. */
function focusField(context) {
  const rows = editableRows(context.rows);
  const asked = rows.find((row) => row.port === context.focusPort);
  const row = asked || rows[0];
  return row ? row.fields.base : null;
}

function windowsTable(rows, crossbar) {
  const table = dom.element("table", "at-table mm-windows");
  const head = dom.element("tr");
  for (const text of ["port", "reaches", "base (offset)", "size", "absolute"])
    head.append(dom.element("th", "", text));
  table.append(head);
  for (const row of rows) table.append(windowLine(row, crossbar));
  return table;
}

function windowLine(row, crossbar) {
  const line = dom.element("tr");
  line.append(dom.element("td", "", row.port));
  if (!row.fields) {
    line.append(noteCell(row.note));
    return line;
  }
  row.absolute = dom.element("td", "mm-absolute");
  line.append(
    dom.element("td", "", row.reaches),
    cellWith(row.fields.base),
    cellWith(row.fields.size),
    row.absolute,
  );
  refreshAbsolute(row, crossbar);
  return line;
}

function noteCell(text) {
  const note = dom.element("td", "mm-muted", text);
  note.colSpan = 4;
  return note;
}

function cellWith(child) {
  const cell = dom.element("td");
  cell.append(child);
  return cell;
}

function refreshAbsolutes(rows, crossbar) {
  for (const row of editableRows(rows)) refreshAbsolute(row, crossbar);
}

/** The absolute span a row's window would have, as it is typed. */
function refreshAbsolute(row, crossbar) {
  row.absolute.textContent = absoluteText(typedWindow(row), crossbar);
}

function absoluteText(typed, crossbar) {
  if (!typed || typed.base === null || !typed.size) return "";
  if (!crossbar) return "(not in a memory map yet)";
  return addresses.spanText(crossbar.base + typed.base, typed.size);
}

/** What a row's fields say: null when both are empty (no window). */
function typedWindow(row) {
  const baseText = row.fields.base.value.trim();
  const sizeText = row.fields.size.value.trim();
  if (!baseText && !sizeText) return null;
  return {
    base: addresses.parseNumber(baseText),
    size: addresses.parseNumber(sizeText),
  };
}

/** What is wrong with the typed windows; empty when they can be saved. */
export function windowProblems(rows, crossbar) {
  const problems = [];
  const placed = [];
  for (const row of editableRows(rows)) {
    const typed = typedWindow(row);
    if (!typed) continue;
    const found = rowProblem(row.port, typed);
    if (found) problems.push(found);
    else placed.push({ port: row.port, ...typed });
  }
  return problems.concat(overlaps(placed), outside(placed, crossbar));
}

function rowProblem(port, typed) {
  if (typed.base === null) return `${port}: the base is not a number.`;
  if (typed.size === null) return `${port}: the size is not a number.`;
  if (typed.size <= 0) return `${port}: the size must be more than 0.`;
  return null;
}

function overlaps(placed) {
  const problems = [];
  const sorted = [...placed].sort((first, second) => first.base - second.base);
  for (let index = 1; index < sorted.length; index++) {
    const before = sorted[index - 1];
    const after = sorted[index];
    if (before.base + before.size > after.base)
      problems.push(`${before.port} and ${after.port} overlap.`);
  }
  return problems;
}

function outside(placed, crossbar) {
  if (!crossbar || !crossbar.size || !crossbar.windowSet) return [];
  const limit = addresses.sizeText(crossbar.size);
  return placed
    .filter((window) => window.base + window.size > crossbar.size)
    .map(
      (window) =>
        `${window.port}: ends outside the crossbar's own window (${limit}).`,
    );
}

/** The windows to send: every connected row whose fields say something new. */
function changedWindows(rows) {
  return editableRows(rows)
    .map(changedWindow)
    .filter((window) => window !== null);
}

/** {ends, base, size} if the row changed its window ({ends, base: null} clears it); else null. */
function changedWindow(row) {
  const typed = typedWindow(row);
  const before = row.window;
  if (!typed) return before ? { ends: row.ends, base: null } : null;
  if (sameWindow(before, typed)) return null;
  return { ends: row.ends, base: typed.base, size: typed.size };
}

function sameWindow(before, typed) {
  if (!before) return false;
  return before.base === typed.base && before.size === typed.size;
}

// ------------------------------------------------------------------ the dialog itself

function labelled(text, input) {
  const label = dom.element("label", "est-field");
  label.append(document.createTextNode(text), input);
  return label;
}

function showProblems(holder, problems) {
  holder.textContent = problems.join(" ");
}

/**
 * Show a dialog {title, hint, body, extraButtons, canSave, focus}; resolves
 * to the button pressed: "ok", "cancel", or an extra button's value. Save
 * does nothing while canSave() is false.
 */
function askInDialog(spec) {
  const dialog = dom.element("dialog", "mm-dialog");
  dialog.append(dialogForm(dialog, spec));
  document.body.append(dialog);
  dialog.showModal();
  if (spec.focus) spec.focus.focus();
  return new Promise((resolve) => {
    dialog.onclose = () => {
      dialog.remove();
      resolve(dialog.returnValue || "cancel");
    };
  });
}

function dialogForm(dialog, spec) {
  const form = dom.element("form");
  form.method = "dialog";
  form.append(
    dom.element("b", "", spec.title),
    dom.element("div", "hint-s", spec.hint),
    ...spec.body,
    dialogButtons(spec.extraButtons),
  );
  form.onsubmit = (event) => refuseUnsavable(event, spec);
  form.onkeydown = (event) => saveOnEnter(event, dialog, spec);
  return form;
}

function refuseUnsavable(event, spec) {
  const pressed = event.submitter && event.submitter.value;
  if (pressed === "ok" && !spec.canSave()) event.preventDefault();
}

/** Enter in a field is Save (never "Remove root", the first button in the form). */
function saveOnEnter(event, dialog, spec) {
  if (event.key !== "Enter" || event.target.tagName !== "INPUT") return;
  event.preventDefault();
  if (spec.canSave()) dialog.close("ok");
}

function dialogButtons(extra) {
  const buttons = dom.element("div", "dlg-buttons");
  for (const [value, text] of extra)
    buttons.append(dialogButton(value, text, "mm-danger"));
  buttons.append(dialogButton("cancel", "Cancel"), dialogButton("ok", "Save"));
  return buttons;
}

function dialogButton(value, text, className) {
  const button = dom.element("button", className || "", text);
  Object.assign(button, { value, type: "submit" });
  return button;
}
