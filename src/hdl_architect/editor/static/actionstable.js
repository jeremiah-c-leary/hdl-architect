// HA 2: the Actions tab of the sequence overlay: the table that edits a
// performed action, one row per action of its action def (HANDOFF decision
// 13, like timing arcs). A row says which part usage performs the action and
// its action def; for each item the action gets (ingress) or gives (egress),
// the port of that part it uses and the item that port carries. Which action
// feeds which ("from", "to") is not chosen here: the core works it out from
// the wires (core/action_links.py), and the table shows it.
import * as actions from "./actions.js";
import * as dialogs from "./dialogs.js";
import * as interaction from "./interaction.js";
import * as menus from "./menus.js";
import * as model from "./model.js";
import * as sequenceView from "./sequenceview.js";
import * as state from "./state.js";
import * as store from "./store.js";
import * as svg from "./svg.js";

const INGRESS = "in";
const EGRESS = "out";
const NEW_ITEM = "(new item)";
const NEW_ACTION_DEF = "(new action def)";
const NOT_PERFORMED = "not performed";
/** Part kinds that bring their own actions (core/action_ops.py, IP_KINDS). */
const IP_KINDS = new Set(["VendorIp", "HardMacro"]);

const COLUMNS = [
  "#",
  "Part usage",
  "Action",
  "Action def",
  "from",
  "Port usage",
  "Item",
  "Port usage",
  "Item",
  "to",
  "Status",
];

/** The performed action shown: its perform's name on the open sheet. */
let shownAction = null;
/** A line's port chosen before its item, by line key (see lineKey). */
const pendingPorts = new Map();
/** The line whose "New item…" form is open, by line key; null if none. */
let newItemLine = null;
/** The empty lines asked for with "+ in" / "+ out", by "action|direction". */
const extraLines = new Set();

// ------------------------------------------------------------------ drawing

/** Draw the table of a performed action of the open sheet. */
export function renderActionsTable(actionName) {
  if (actionName !== shownAction) forgetEdits();
  shownAction = actionName;
  const holder = svg.$("actionsTable");
  holder.innerHTML = "";
  const action = actions.sheetAction(actionName);
  if (!action) return;
  holder.append(tableOf(action), addActionForm());
}

function forgetEdits() {
  pendingPorts.clear();
  extraLines.clear();
  newItemLine = null;
}

function redraw() {
  renderActionsTable(shownAction);
}

function tableOf(action) {
  const table = element("table", "at-table");
  const body = element("tbody");
  action.steps.forEach((step, index) => {
    body.append(...rowsOf({ action, step, index }));
  });
  table.append(headOf(), body);
  return table;
}

function headOf() {
  const head = element("thead");
  const groups = element("tr", "at-groups");
  groups.append(
    headCell("", 4),
    headCell("Ingress", 3),
    headCell("Egress", 3),
    headCell("", 1),
  );
  const names = element("tr");
  for (const name of COLUMNS) names.append(headCell(name, 1));
  head.append(groups, names);
  return head;
}

function headCell(text, span) {
  const cell = element("th", "", text);
  cell.colSpan = span;
  return cell;
}

/**
 * One table row per line: line n holds the action's n-th ingress and n-th
 * egress. The action's own cells span all its lines.
 */
function rowsOf(place) {
  const ingress = linesOf(place.step, INGRESS);
  const egress = linesOf(place.step, EGRESS);
  const count = Math.max(ingress.length, egress.length);
  const rows = [];
  for (let line = 0; line < count; line++)
    rows.push(lineRow(place, { ingress: ingress[line], egress: egress[line] }));
  rows[0].prepend(...actionCells(place, count));
  rows[0].append(spanned(statusCell(place), count));
  return rows;
}

/** The action's items in one direction, and an empty line to add one. */
function linesOf(step, direction) {
  const lines = step.items.filter((item) => item.direction === direction);
  if (!lines.length || extraLines.has(extraKey(step.name, direction)))
    lines.push(emptyLine(direction));
  return lines;
}

function emptyLine(direction) {
  return { item: null, itemType: null, direction, port: null, portItem: null };
}

function extraKey(stepName, direction) {
  return `${stepName}|${direction}`;
}

function lineRow(place, pair) {
  const row = element("tr", "at-line");
  if (place.index % 2) row.classList.add("at-odd");
  row.append(...ingressCells(place, pair.ingress));
  row.append(...egressCells(place, pair.egress));
  row.oncontextmenu = (event) => rowMenu(event, place);
  return row;
}

function ingressCells(place, line) {
  if (!line) return emptyCells();
  return [fromCell(place, line), portCell(place, line), itemCell(place, line)];
}

function egressCells(place, line) {
  if (!line) return emptyCells();
  return [portCell(place, line), itemCell(place, line), toCell(place, line)];
}

function emptyCells() {
  return [element("td"), element("td"), element("td")];
}

function spanned(cell, span) {
  cell.rowSpan = span;
  return cell;
}

// ------------------------------------------------------------------ the action's cells

function actionCells(place, span) {
  const cells = [
    numberCell(place),
    partCell(place),
    nameCell(place),
    actionDefCell(place),
  ];
  return cells.map((cell) => spanned(cell, span));
}

/** "1", with ↑ ↓ to move the action in the order. */
function numberCell(place) {
  const cell = element("td", "at-number", `${place.index + 1}`);
  cell.append(
    button("↑", "Move up", () => moveAction(place, -1)),
    button("↓", "Move down", () => moveAction(place, 1)),
  );
  return cell;
}

function partCell(place) {
  const cell = element("td");
  const parts = model
    .partsOf(state.editor.sheet)
    .map((part) => [
      part.name,
      `${part.name} : ${model.unqualifiedName(part.type)}`,
    ]);
  const select = picker([["", "—"], ...parts], place.step.part || "");
  select.dataset.role = `${place.step.name}|part`;
  select.onchange = () => setPart(place, select.value);
  cell.append(select);
  return cell;
}

/** The action's name, with "+ in" and "+ out" to add an ingress or egress. */
function nameCell(place) {
  const cell = element("td", "at-name");
  cell.append(element("div", "", place.step.name));
  if (canChangeItems(place.step))
    cell.append(
      button("+ in", "Add an ingress line", () => addLine(place, INGRESS)),
      button("+ out", "Add an egress line", () => addLine(place, EGRESS)),
    );
  return cell;
}

/** The action defs the performer performs, then the others (not for IP). */
function actionDefCell(place) {
  const cell = element("td");
  const select = groupedPicker(
    actionDefGroups(place.step),
    place.step.actionDef,
  );
  select.dataset.role = `${place.step.name}|actionDef`;
  select.onchange = () => setActionDef(place, select.value);
  cell.append(select);
  return cell;
}

function actionDefGroups(step) {
  const performed = performedActionDefs(step.partDef);
  const groups = [
    { label: `Performed by ${step.part || "no part"}`, names: performed },
  ];
  if (isIp(step.partDef)) return groups;
  const others = model
    .actionDefNames()
    .filter((name) => !performed.includes(name) && name !== composedName());
  groups.push({ label: "Other action defs", names: others });
  groups.push({
    label: "",
    names: [],
    extra: [[NEW_ACTION_DEF, "New action def…"]],
  });
  return groups;
}

function performedActionDefs(defName) {
  const definition = defName && model.partDef(defName);
  if (!definition) return [];
  return (definition.performs || []).map((perform) =>
    model.unqualifiedName(perform.type),
  );
}

function composedName() {
  return actions.sheetAction(shownAction).actionDef;
}

function statusCell(place) {
  const cell = element("td", "at-status", place.step.status);
  const missing = missingText(place);
  if (missing) markMissing(cell, missing);
  return cell;
}

/** Why the action has ⚠: an item with no wire, or an ingress nothing feeds. */
function missingText(place) {
  const name = place.step.name;
  const unwired = place.action.flows.filter(
    (flow) =>
      flow.wired === false && (flow.source === name || flow.target === name),
  );
  if (unwired.length) return "an item it gets or gives has no wire";
  const unfed = place.step.items.filter(
    (line) =>
      line.direction === INGRESS && line.port && !feedersOf(place, line).length,
  );
  if (unfed.length) return "nothing feeds an item it gets";
  return "";
}

// ------------------------------------------------------------------ a line's cells

function fromCell(place, line) {
  const links = feedersOf(place, line).map((flow) => ({
    step: flow.source,
    wired: flow.wired,
  }));
  return linkCell(place, line, links);
}

function toCell(place, line) {
  const links = takersOf(place, line).map((flow) => ({
    step: flow.target,
    wired: flow.wired,
  }));
  return linkCell(place, line, links);
}

function feedersOf(place, line) {
  return place.action.flows.filter(
    (flow) => flow.target === place.step.name && flow.targetItem === line.item,
  );
}

function takersOf(place, line) {
  return place.action.flows.filter(
    (flow) => flow.source === place.step.name && flow.sourceItem === line.item,
  );
}

/** The actions it links to, by number ("sheet" at the edge), or why none. */
function linkCell(place, line, links) {
  const cell = element("td", "at-link");
  if (!line.item) return cell;
  if (!links.length) return unlinkedCell(cell, line);
  cell.textContent = links
    .map((link) => linkLabel(place.action, link))
    .join(", ");
  if (links.some((link) => link.wired === false))
    markMissing(cell, "no wire for it");
  return cell;
}

function linkLabel(action, link) {
  if (link.step === null) return "sheet";
  return `${action.steps.findIndex((step) => step.name === link.step) + 1}`;
}

function unlinkedCell(cell, line) {
  if (!line.port) {
    cell.textContent = "—";
    return cell;
  }
  if (line.direction === EGRESS) {
    cell.textContent = "nobody yet";
    cell.classList.add("at-muted");
    return cell;
  }
  cell.textContent = "⚠";
  markMissing(cell, unfedText(line));
  return cell;
}

function unfedText(line) {
  return (
    `Nothing feeds ${line.item}: no earlier egress of ${line.itemType} on a ` +
    `port wired to ${line.port}, and no wire from the sheet's own port.`
  );
}

/** The performer's ports; none to choose while no part performs the action. */
function portCell(place, line) {
  const cell = element("td");
  if (!canChoosePorts(place.step)) return cell;
  const ports = model
    .portsOfDef(place.step.partDef)
    .map((port) => [model.portId(port), model.shown(port)]);
  const select = picker([["", "—"], ...ports], chosenPort(place, line));
  select.dataset.role = `${lineKey(place, line)}|port`;
  select.onchange = () => choosePort(place, line, select.value);
  cell.append(select);
  return cell;
}

function canChoosePorts(step) {
  return Boolean(step.part) && step.status !== NOT_PERFORMED;
}

/** The items the chosen port carries in the line's direction, or a new one. */
function itemCell(place, line) {
  const cell = element("td");
  const port = chosenPortUsage(place, line);
  if (!port) return cell;
  if (newItemLine === lineKey(place, line)) {
    cell.append(newItemForm(place, line));
    return cell;
  }
  const items = carriedItems(port, line).map((item) => [
    item.name,
    `${item.name} : ${model.unqualifiedName(item.type)}`,
  ]);
  const options = [["", "choose…"], ...items, [NEW_ITEM, "New item…"]];
  const select = picker(options, selectedPortItem(place, line));
  select.dataset.role = `${lineKey(place, line)}|item`;
  select.onchange = () => chooseItem(place, line, select.value);
  cell.append(select);
  cell.oncontextmenu = (event) => lineMenu(event, place, line);
  return cell;
}

/** A line already on an item only offers items of that item def. */
function carriedItems(port, line) {
  return (port.items || []).filter(
    (item) =>
      item.direction === line.direction &&
      (!line.item || model.unqualifiedName(item.type) === line.itemType),
  );
}

function selectedPortItem(place, line) {
  if (chosenPort(place, line) !== line.port) return "";
  return line.portItem || "";
}

function lineKey(place, line) {
  return `${place.step.name}|${line.direction}|${line.item || "+"}`;
}

function chosenPort(place, line) {
  const key = lineKey(place, line);
  if (pendingPorts.has(key)) return pendingPorts.get(key);
  return line.port || "";
}

function chosenPortUsage(place, line) {
  const portName = chosenPort(place, line);
  if (!portName) return null;
  const ports = model.portsOfDef(place.step.partDef);
  return ports.find((port) => model.portId(port) === portName) || null;
}

/** Name and item def of a new item the port carries from now on. */
function newItemForm(place, line) {
  const form = element("span", "at-new-item");
  const name = input("name", line.item || "");
  const itemDef = input("item def", line.itemType || "");
  itemDef.setAttribute("list", itemDefList().id);
  if (line.item) itemDef.readOnly = true;
  const add = () =>
    addNewItem(place, line, { name: name.value, type: itemDef.value });
  for (const field of [name, itemDef])
    field.onkeydown = (event) => formKey(event, add);
  form.append(
    name,
    itemDef,
    button("OK", "Add the item to the port", add),
    button("Cancel", "", cancelNewItem),
  );
  return form;
}

function formKey(event, add) {
  event.stopPropagation(); // Escape here cancels the form, not the overlay
  if (event.key === "Enter") add();
  if (event.key === "Escape") cancelNewItem();
}

/** The item defs to choose from while typing one (made once). */
function itemDefList() {
  let list = svg.$("atItemDefs");
  if (!list) {
    list = element("datalist");
    list.id = "atItemDefs";
    document.body.append(list);
  }
  list.innerHTML = "";
  for (const name of model.itemDefNames()) list.append(new Option(name));
  return list;
}

// ------------------------------------------------------------------ the add-action form

/** [+ Action]: a name and the part usage that performs it. */
function addActionForm() {
  const form = element("div", "at-add");
  const name = input("action name", "");
  name.id = "atNewName";
  const parts = model
    .partsOf(state.editor.sheet)
    .map((part) => [part.name, part.name]);
  const part = picker(parts, "");
  part.id = "atNewPart";
  const add = () => addAction(name.value.trim(), part.value);
  name.onkeydown = (event) => formKey(event, add);
  form.append(
    button("+ Action", "Add an action performed by the part", add),
    name,
    part,
  );
  return form;
}

// ------------------------------------------------------------------ menus

function rowMenu(event, place) {
  event.preventDefault();
  const items = [
    { head: `${place.step.name} : ${place.step.actionDef}` },
    { label: "Move up", act: () => moveAction(place, -1) },
    { label: "Move down", act: () => moveAction(place, 1) },
    { label: "Delete action", act: () => deleteAction(place) },
  ];
  if (place.step.partDef && model.isSheet(place.step.partDef))
    items.push({
      label: `Open ${place.step.partDef} (to break it down)`,
      act: () => openPerformer(place),
    });
  menus.menu(event.clientX, event.clientY, items);
}

function lineMenu(event, place, line) {
  event.preventDefault();
  event.stopPropagation();
  if (!line.item || !canChangeItems(place.step)) return;
  menus.menu(event.clientX, event.clientY, [
    { head: `${line.item} : ${line.itemType}` },
    { label: "No port", act: () => clearLine(place, line) },
    {
      label: `Remove ${line.item} from ${place.step.actionDef}`,
      act: () => removeItem(place, line),
    },
  ]);
}

// ------------------------------------------------------------------ edits

function where(place) {
  return {
    sheet: state.editor.sheet,
    perform: shownAction,
    step: place.step.name,
  };
}

function moveAction(place, offset) {
  const index = place.index + offset;
  if (index < 0 || index >= place.action.steps.length) return;
  store.applyOp("move_step", { ...where(place), index });
}

function setPart(place, part) {
  if (!part) return;
  store.applyOp("set_step_part", { ...where(place), part });
}

function setActionDef(place, value) {
  let actionDef = value;
  if (value === NEW_ACTION_DEF)
    actionDef = dialogs.askName("New action def:", "");
  if (!actionDef) {
    redraw();
    return;
  }
  store.applyOp("set_step_action", { ...where(place), action: actionDef });
}

function addLine(place, direction) {
  extraLines.add(extraKey(place.step.name, direction));
  redraw();
}

function choosePort(place, line, port) {
  const key = lineKey(place, line);
  if (port) {
    pendingPorts.set(key, port);
    redraw();
    return;
  }
  pendingPorts.delete(key);
  if (line.item && line.port) clearLine(place, line);
  else redraw();
}

function chooseItem(place, line, value) {
  if (value === NEW_ITEM) {
    newItemLine = lineKey(place, line);
    redraw();
    return;
  }
  if (value) setEnd(place, line, { portItem: value });
}

function addNewItem(place, line, newItem) {
  const name = newItem.name.trim();
  const type = newItem.type.trim();
  if (!state.NAME_RE.test(name) || !state.NAME_RE.test(type)) {
    alert("The item and its item def each need a legal name.");
    return;
  }
  setEnd(place, line, { newPortItem: { name, type } });
}

function cancelNewItem() {
  newItemLine = null;
  redraw();
}

/** set_action_end: the line's port and the item it carries; the core then links it. */
function setEnd(place, line, choice) {
  const args = {
    ...where(place),
    direction: line.direction,
    port: chosenPort(place, line),
    ...choice,
  };
  if (line.item) args.item = line.item;
  const key = lineKey(place, line);
  store.applyOp("set_action_end", args, () => forgetLine(key));
}

function forgetLine(key) {
  pendingPorts.delete(key);
  newItemLine = null;
  extraLines.delete(key.split("|").slice(0, 2).join("|"));
}

function clearLine(place, line) {
  const args = { ...where(place), direction: line.direction, item: line.item };
  store.applyOp("set_action_end", args);
}

function removeItem(place, line) {
  const question =
    `Remove ${line.item} from ${place.step.actionDef}? Every use of ` +
    `${place.step.actionDef} loses it, with its links.`;
  if (!confirm(question)) return;
  store.applyOp("delete_action_item", {
    action: place.step.actionDef,
    item: line.item,
  });
}

function deleteAction(place) {
  if (!confirm(`Delete ${place.step.name} from ${composedName()}?`)) return;
  store.applyOp("delete_step", where(place));
}

function openPerformer(place) {
  sequenceView.closeSequence();
  interaction.openSheet(place.step.partDef);
}

function addAction(name, part) {
  if (!state.NAME_RE.test(name)) {
    alert(`"${name}" is not a legal name for an action.`);
    return;
  }
  const args = { sheet: state.editor.sheet, perform: shownAction, name, part };
  store.applyOp("add_step", args);
}

// ------------------------------------------------------------------ helpers

function canChangeItems(step) {
  return canChoosePorts(step) && !isIp(step.partDef);
}

function isIp(defName) {
  return IP_KINDS.has(model.kindOf(defName || ""));
}

function markMissing(cell, why) {
  cell.classList.add("at-missing");
  cell.title = why;
  if (!cell.textContent.includes("⚠")) cell.append(" ⚠");
}

function element(tag, className, text) {
  const made = document.createElement(tag);
  if (className) made.className = className;
  if (text !== undefined) made.textContent = text;
  return made;
}

function button(text, title, act) {
  const made = element("button", "at-button", text);
  made.title = title;
  made.onclick = (event) => {
    event.stopPropagation();
    act();
  };
  return made;
}

function input(placeholder, value) {
  const made = element("input");
  made.placeholder = placeholder;
  made.value = value;
  return made;
}

/** A <select> of [value, label] options, with `selected` chosen. */
function picker(options, selected) {
  const select = element("select");
  for (const [value, label] of options) select.append(new Option(label, value));
  select.value = selected;
  return select;
}

/** A <select> of groups {label, names, extra?}, with `selected` chosen. */
function groupedPicker(groups, selected) {
  const select = element("select");
  for (const group of groups) select.append(optionGroup(group));
  select.value = selected;
  return select;
}

function optionGroup(group) {
  const holder = element("optgroup");
  holder.label = group.label;
  for (const name of group.names) holder.append(new Option(name, name));
  for (const [value, label] of group.extra || [])
    holder.append(new Option(label, value));
  return holder;
}
