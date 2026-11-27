// HA 2: the Actions tab of the sequence view: the table that edits a
// performed action (HANDOFF decision 13, like timing arcs). Each action of
// its action def is a row: the part usage that performs it, its action def,
// and the ports its items come in by (ingress) and go out by (egress).
// Between the rows are the hops (actionhops.js): the item that goes from one
// action to the next over a wire, chosen once for both ends. The actions are
// added by walking the sheet (actionwalk.js); [+ Action] adds one by hand.
import * as actionHops from "./actionhops.js";
import * as actions from "./actions.js";
import * as dialogs from "./dialogs.js";
import * as dom from "./dom.js";
import * as interaction from "./interaction.js";
import * as menus from "./menus.js";
import * as model from "./model.js";
import * as sequenceView from "./sequenceview.js";
import * as state from "./state.js";
import * as store from "./store.js";
import * as svg from "./svg.js";

const INGRESS = "in";
const EGRESS = "out";
const NEW_ACTION_DEF = "(new action def)";
const NOT_PERFORMED = "not performed";
/** Part kinds that bring their own actions (core/action_ops.py, IP_KINDS). */
const IP_KINDS = new Set(["VendorIp", "HardMacro"]);

const COLUMNS = [
  "#",
  "Part usage",
  "Action",
  "Action def",
  "Ingress port",
  "Egress port",
  "Status",
];

/** The performed action shown: its perform's name on the open sheet. */
let shownAction = null;
/** Rows added with [+ Action], not saved until their action def is chosen: {part}. */
const drafts = [];

// ------------------------------------------------------------------ drawing

/** Draw the table of a performed action of the open sheet. */
export function renderActionsTable(actionName) {
  actionHops.showHopsOf(actionName, redraw);
  if (actionName !== shownAction) drafts.length = 0;
  shownAction = actionName;
  const holder = svg.$("actionsTable");
  holder.innerHTML = "";
  const action = actions.sheetAction(actionName);
  if (!action) return;
  holder.append(tableOf(action), addActionLine(), ownItemsLine(action));
}

function redraw() {
  renderActionsTable(shownAction);
}

function tableOf(action) {
  const table = dom.element("table", "at-table");
  const body = dom.element("tbody");
  action.steps.forEach((step, index) => {
    body.append(...rowsOf({ action, step, index }));
  });
  for (const draft of drafts) body.append(draftRow(draft));
  table.append(headOf(), body);
  return table;
}

function headOf() {
  const head = dom.element("thead");
  const names = dom.element("tr");
  for (const name of COLUMNS) names.append(dom.element("th", "", name));
  head.append(names);
  return head;
}

/** An action's row, with the hops into it before and those out of it after. */
function rowsOf(place) {
  return [
    ...actionHops.hopRowsBefore(place),
    actionRow(place),
    ...actionHops.hopRowsAfter(place),
  ];
}

function actionRow(place) {
  const row = dom.element("tr", "at-line");
  row.append(
    numberCell(place),
    partCell(place),
    dom.element("td", "at-name", place.step.name),
    actionDefCell(place),
    portsCell(place, INGRESS),
    portsCell(place, EGRESS),
    statusCell(place),
  );
  row.oncontextmenu = (event) => rowMenu(event, place);
  return row;
}

// ------------------------------------------------------------------ the action's cells

/** "1", with ↑ ↓ to move the action in the order, and ✕ to delete it. */
function numberCell(place) {
  const cell = dom.element("td", "at-number", `${place.index + 1}`);
  cell.append(
    dom.button("↑", "Move up", () => moveAction(place, -1)),
    dom.button("↓", "Move down", () => moveAction(place, 1)),
    dom.button("✕", "Delete this action", () => deleteAction(place)),
  );
  return cell;
}

function partCell(place) {
  const cell = dom.element("td");
  const options = [["", "—"], ...partOptions()];
  const select = dom.picker(options, place.step.part || "");
  select.dataset.role = `${place.step.name}|part`;
  select.onchange = () => setPart(place, select.value);
  cell.append(select);
  return cell;
}

/** The action defs the performer performs, then the others (not for IP). */
function actionDefCell(place) {
  const cell = dom.element("td");
  const select = dom.groupedPicker(
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

/** The ports of the action's items one way. */
function portsCell(place, direction) {
  const cell = dom.element("td", "at-ports");
  const lines = place.step.items.filter((line) => line.direction === direction);
  for (const line of lines) cell.append(linePort(place, line));
  return cell;
}

/** A port the action uses (right-click: no port, remove the item, ...). */
function linePort(place, line) {
  const tag = dom.element("div", "at-port", portText(place.step, line));
  tag.title = `${line.item} : ${line.itemType}`;
  if (!line.port) tag.classList.add("at-muted");
  tag.oncontextmenu = (event) => lineMenu(event, place, line);
  return tag;
}

function portText(step, line) {
  if (!line.port) return `${line.item} : ${line.itemType}, no port`;
  return actionHops.portLabel(step.partDef, line.port);
}

function statusCell(place) {
  const cell = dom.element("td", "at-status", place.step.status);
  const missing = missingText(place);
  if (missing) dom.markMissing(cell, missing);
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
    (line) => line.direction === INGRESS && line.port && !isFed(place, line),
  );
  if (unfed.length) return "nothing feeds an item it gets";
  return "";
}

function isFed(place, line) {
  return place.action.flows.some(
    (flow) => flow.target === place.step.name && flow.targetItem === line.item,
  );
}

// ------------------------------------------------------------------ a row not saved yet

/** [+ Action], and how to build the table from the sheet instead. */
function addActionLine() {
  const holder = dom.element("div", "at-add");
  const add = dom.button(
    "+ Action",
    "Add a row: its part usage, then its action def",
    addDraft,
  );
  add.id = "atAddAction";
  const hint =
    "Or walk the sheet above: click the sheet port the request comes in by, " +
    "then each part it reaches.";
  holder.append(add, dom.element("span", "at-muted", hint));
  return holder;
}

/** A row of [+ Action], not saved yet: the part usage first; its action def then makes it. */
function draftRow(draft) {
  const row = dom.element("tr", "at-line at-draft");
  const index = drafts.indexOf(draft);
  const number = dom.element("td", "at-number", `${draftNumber(index)}`);
  number.append(dom.button("✕", "Discard this row", () => discardDraft(draft)));
  const hint = dom.element("td", "at-muted", draftHint(draft));
  hint.colSpan = 3;
  row.append(number, draftPartCell(draft), dom.element("td", "", "—"));
  row.append(draftActionDefCell(draft), hint);
  return row;
}

function draftNumber(index) {
  return actions.sheetAction(shownAction).steps.length + index + 1;
}

function draftHint(draft) {
  if (!draft.part) return "Choose the part usage that performs it.";
  return `Choose an action def: what ${draft.part} performs, or another.`;
}

function draftPartCell(draft) {
  const cell = dom.element("td");
  const options = [["", "choose…"], ...partOptions()];
  const select = dom.picker(options, draft.part);
  select.dataset.role = `draft${drafts.indexOf(draft)}|part`;
  select.onchange = () => {
    draft.part = select.value;
    redraw();
  };
  cell.append(select);
  return cell;
}

function draftActionDefCell(draft) {
  const cell = dom.element("td");
  if (!draft.part) return cell;
  const performer = {
    part: draft.part,
    partDef: model.partType(state.editor.sheet, draft.part),
  };
  const select = dom.groupedPicker(actionDefGroups(performer), "");
  select.dataset.role = `draft${drafts.indexOf(draft)}|actionDef`;
  select.onchange = () => chooseDraftActionDef(draft, select.value);
  cell.append(select);
  return cell;
}

function partOptions() {
  return model
    .partsOf(state.editor.sheet)
    .map((part) => [part.name, partText(part.name)]);
}

function partText(partName) {
  const type = model.partType(state.editor.sheet, partName);
  return `${partName} : ${model.unqualifiedName(type || "")}`;
}

// ------------------------------------------------------------------ the action's own items

/** "ReadTemperature's own items": what it gets and gives as a whole, with ✕ on those nothing uses. */
function ownItemsLine(action) {
  const line = dom.element("div", "at-own");
  if (!action.items.length) return line;
  line.append(
    dom.element("span", "at-muted", `${action.actionDef}'s own items: `),
  );
  for (const item of action.items) line.append(ownItem(action, item));
  return line;
}

function ownItem(action, item) {
  const tag = dom.element("span", "at-own-item", ownItemText(item));
  if (isOwnItemUsed(action, item)) return tag;
  tag.classList.add("at-muted");
  tag.title = "Nothing uses it";
  tag.append(
    dom.button("✕", "Remove it from the action def", () =>
      removeOwnItem(action, item),
    ),
  );
  return tag;
}

function ownItemText(item) {
  const way = item.direction === INGRESS ? "gets" : "gives";
  return `${way} ${item.item} : ${item.itemType}`;
}

function isOwnItemUsed(action, item) {
  return action.flows.some(
    (flow) =>
      (flow.source === null && flow.sourceItem === item.item) ||
      (flow.target === null && flow.targetItem === item.item),
  );
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
  if (!canChangeItems(place.step)) return;
  const items = [
    ...itemEntries(place, line),
    ...unusedPortItemEntries(place, line),
  ];
  menus.menu(event.clientX, event.clientY, items);
}

function itemEntries(place, line) {
  const entries = [{ head: `${line.item} : ${line.itemType}` }];
  if (line.port)
    entries.push({ label: "No port", act: () => clearLine(place, line) });
  entries.push({
    label: `Remove ${line.item} from ${place.step.actionDef}`,
    act: () => removeItem(place, line),
  });
  return entries;
}

/** The line's port's items that no flow of the performer uses: to remove. */
function unusedPortItemEntries(place, line) {
  const port = model
    .portsOfDef(place.step.partDef)
    .find((usage) => model.portId(usage) === line.port);
  if (!port) return [];
  const unused = (port.items || []).filter(
    (item) => !isPortItemUsed(place.step.partDef, portItemRef(port, item)),
  );
  return unused.map((item) => ({
    label: `Remove unused ${item.name} : ${model.unqualifiedName(item.type)} from port ${model.shown(port)}`,
    act: () => removePortItem(place, portItemRef(port, item)),
  }));
}

function portItemRef(port, item) {
  return `${model.portId(port)}.${item.name}`;
}

function isPortItemUsed(defName, ref) {
  const flows = model.partDef(defName).flows || [];
  return flows.some((flow) => flow.from === ref || flow.to === ref);
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
  const actionDef = askedActionDef(value);
  if (!actionDef) {
    redraw();
    return;
  }
  store.applyOp("set_step_action", { ...where(place), action: actionDef });
}

/** The action def chosen, or the name of a new one asked for. */
function askedActionDef(value) {
  if (value === NEW_ACTION_DEF) return dialogs.askName("New action def:", "");
  return value;
}

/** No port: the line's item no longer says which port it uses, and loses its links. */
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

function addDraft() {
  drafts.push({ part: "" });
  redraw();
}

function discardDraft(draft) {
  drafts.splice(drafts.indexOf(draft), 1);
  redraw();
}

/** The draft's action def makes the action, named after it (ReadFrame: readFrame). */
function chooseDraftActionDef(draft, value) {
  const actionDef = askedActionDef(value);
  if (!actionDef) {
    redraw();
    return;
  }
  const args = {
    sheet: state.editor.sheet,
    perform: shownAction,
    name: uniqueActionName(lowerFirst(actionDef)),
    part: draft.part,
    action: actionDef,
  };
  store.applyOp("add_step", args, () =>
    drafts.splice(drafts.indexOf(draft), 1),
  );
}

function lowerFirst(name) {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/** `base`, or base_2, base_3, ... if an action of that name exists. */
function uniqueActionName(base) {
  const taken = new Set(
    actions.sheetAction(shownAction).steps.map((step) => step.name),
  );
  let name = base;
  for (let number = 2; taken.has(name); number++) name = `${base}_${number}`;
  return name;
}

function removePortItem(place, ref) {
  store.applyOp("delete_port_item", { def: place.step.partDef, item: ref });
}

function removeOwnItem(action, item) {
  const question = `Remove ${item.item} from ${action.actionDef}?`;
  if (!confirm(question)) return;
  store.applyOp("delete_action_item", {
    action: action.actionDef,
    item: item.item,
  });
}

// ------------------------------------------------------------------ helpers

function canChangeItems(step) {
  if (!step.part || step.status === NOT_PERFORMED) return false;
  return !isIp(step.partDef);
}

function isIp(defName) {
  return IP_KINDS.has(model.kindOf(defName || ""));
}
