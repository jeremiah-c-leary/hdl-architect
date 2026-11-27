// HA 2: hops in the actions table. A hop is one item going from one action
// to the next over one wire: a connection row of the table (in SysML a
// succession flow between the two actions' items, over the connection
// between their parts' ports; core/action_hops.py). The item is chosen
// once, on the hop, so the egress and the ingress it joins cannot disagree:
// another item def there changes both ends (set_hop). An IP's items are
// fixed: a hop with an IP end offers only that IP's items.
//
// The actions themselves are added by the walk (actionwalk.js) or with
// [+ Action]; this module draws the hops between them.
import * as dom from "./dom.js";
import * as model from "./model.js";
import * as state from "./state.js";
import * as store from "./store.js";
import * as svg from "./svg.js";

const NEW_ITEM = "(new item)";
const SOURCE = "source";
const INGRESS = "in";
const EGRESS = "out";
/** Part kinds that bring their own actions (core/action_ops.py, IP_KINDS). */
const IP_KINDS = new Set(["VendorIp", "HardMacro"]);

/** The performed action the table shows, and how to draw the table again. */
const table = { action: null, redraw: () => {} };
/** The hop whose "New item…" form is open: its key; null if none. */
let formFor = null;

/** The table shows `actionName`; an open form for another action goes. */
export function showHopsOf(actionName, redraw) {
  if (actionName !== table.action) formFor = null;
  table.action = actionName;
  table.redraw = redraw;
}

// ------------------------------------------------------------------ the connection rows

/** The connection rows before an action: the hops into it, and its ingresses nothing feeds. */
export function hopRowsBefore(place) {
  const name = place.step.name;
  const rows = place.action.flows
    .filter((flow) => flow.target === name)
    .map((flow) => savedHopRow(place.action, flow));
  for (const line of unlinkedLines(place, INGRESS))
    rows.push(lineNoteRow(place, line));
  return rows;
}

/** The connection rows after an action: its hops out to the sheet, and its egresses nobody takes. */
export function hopRowsAfter(place) {
  const name = place.step.name;
  const rows = place.action.flows
    .filter((flow) => flow.source === name && flow.target === null)
    .map((flow) => savedHopRow(place.action, flow));
  for (const line of unlinkedLines(place, EGRESS))
    rows.push(lineNoteRow(place, line));
  return rows;
}

/** The lines on a port that no flow uses yet. */
function unlinkedLines(place, direction) {
  const lines = place.step.items.filter(
    (line) => line.direction === direction && line.port,
  );
  return lines.filter((line) => !isLinked(place, line));
}

function isLinked(place, line) {
  const name = place.step.name;
  return place.action.flows.some(
    (flow) =>
      (flow.target === name && flow.targetItem === line.item) ||
      (flow.source === name && flow.sourceItem === line.item),
  );
}

function savedHopRow(action, flow) {
  const hop = savedHop(action, flow);
  const row = hopRow(hop, action);
  if (flow.wired === false)
    dom.markMissing(row.lastChild, "No wire carries this item.");
  return row;
}

/** A saved flow as a hop: its ends, the items they are now, and the item it carries. */
function savedHop(action, flow) {
  return {
    key: `${flow.source}.${flow.sourceItem}>${flow.target}.${flow.targetItem}`,
    source: savedEnd(flow.source, flow.sourceItem, flow.sourceEnd),
    target: savedEnd(flow.target, flow.targetItem, flow.targetEnd),
    item: savedItem(action, flow),
  };
}

/** A saved end: the sheet's own port (step null), or a step's item on its part's port. */
function savedEnd(step, item, endText) {
  const segments = (endText || "?").split(".");
  if (step === null) return { part: null, port: segments[0] };
  return { part: segments[0], port: segments[1] || "?", step, item };
}

/** The item a saved hop carries, named as the port at its action end names it. */
function savedItem(action, flow) {
  const line =
    stepLine(action, flow.source, flow.sourceItem) ||
    stepLine(action, flow.target, flow.targetItem);
  const name = (line && line.portItem) || flow.sourceItem;
  return { name, type: flow.itemType };
}

function stepLine(action, stepName, item) {
  const step = action.steps.find((candidate) => candidate.name === stepName);
  if (!step) return null;
  return step.items.find((line) => line.item === item) || null;
}

/** "↳ eth_rgmii (sheet) ──▶ 1 ethernet.eth_rgmii   item [rxFrame : EthFrame]" */
function hopRow(hop, action) {
  const row = dom.element("tr", "at-hop");
  const body = dom.element("td", "at-hop-body");
  body.colSpan = 6;
  body.append(endsText(hop, action), dom.element("span", "at-muted", "item"));
  body.append(itemPart(hop));
  row.append(dom.element("td", "at-hop-mark", "↳"), body);
  return row;
}

function endsText(hop, action) {
  const text = `${endLabel(hop.source, action)} ──▶ ${endLabel(hop.target, action)}`;
  return dom.element("span", "at-hop-ends", text);
}

/** "eth_rgmii (sheet)", or "2 Control.ETH CSR" (the row, the part, the port). */
function endLabel(end, action) {
  const port = portLabel(partDefOf(end), end.port);
  if (end.part === null) return `${port} (sheet)`;
  const row = action.steps.findIndex((step) => step.name === end.step) + 1;
  return `${row} ${end.part}.${port}`;
}

// ------------------------------------------------------------------ the items a hop can carry

/** The items a hop can carry: those its two ports carry its way; only an IP end's if it has one. */
function itemChoices(hop) {
  const from = endItems(hop.source, SOURCE);
  const into = endItems(hop.target, "target");
  if (from.fixed && into.fixed) return sameTypes(from.items, into.items);
  if (from.fixed) return from.items;
  if (into.fixed) return into.items;
  return uniqueItems([...from.items, ...into.items]);
}

function canMakeItem(hop) {
  const from = endItems(hop.source, SOURCE);
  const into = endItems(hop.target, "target");
  return !from.fixed && !into.fixed;
}

/** The items an end's port carries the hop's way, and whether they are fixed (IP). */
function endItems(end, side) {
  const defName = partDefOf(end);
  const port = portUsage(defName, end.port);
  const direction = itemDirection(end, side);
  const items = ((port && port.items) || [])
    .filter((item) => item.direction === direction)
    .map((item) => ({
      name: item.name,
      type: model.unqualifiedName(item.type),
    }));
  return { items, fixed: end.part !== null && isIp(defName) };
}

/** Out of a part at a hop's source, into it at the target; the sheet's own port the other way round. */
function itemDirection(end, side) {
  const leaves = side === SOURCE;
  const atSheet = end.part === null;
  if (leaves !== atSheet) return EGRESS;
  return INGRESS;
}

function sameTypes(items, others) {
  return items.filter((item) =>
    others.some((other) => other.type === item.type),
  );
}

function uniqueItems(items) {
  const seen = new Map();
  for (const item of items) seen.set(itemValue(item), item);
  return [...seen.values()];
}

function itemValue(item) {
  return `${item.name}|${item.type}`;
}

function itemLabel(item) {
  return `${item.name} : ${item.type}`;
}

function parseItem(value) {
  const [name, type] = value.split("|");
  return { name, type };
}

function hopArgs(hop) {
  return {
    sheet: state.editor.sheet,
    perform: table.action,
    source: endArgs(hop.source),
    target: endArgs(hop.target),
    item: hop.item,
  };
}

/** A hop end as set_hop takes it: {step, port, item?}. */
function endArgs(end) {
  const args = { step: end.step || null, port: end.port };
  if (end.item) args.item = end.item;
  return args;
}

// ------------------------------------------------------------------ choosing a hop's item

function itemPart(hop) {
  if (formFor === hop.key) return itemForm(hop);
  return itemPicker(hop);
}

function itemPicker(hop) {
  const choices = withCurrent(itemChoices(hop), hop.item);
  const options = [];
  for (const item of choices) options.push([itemValue(item), itemLabel(item)]);
  if (canMakeItem(hop)) options.push([NEW_ITEM, "New item…"]);
  const select = dom.picker(options, itemValue(hop.item));
  select.dataset.role = `${hop.key}|item`;
  select.onchange = () => chooseHopItem(hop, select.value);
  return select;
}

function withCurrent(choices, current) {
  if (choices.some((item) => itemValue(item) === itemValue(current)))
    return choices;
  return [current, ...choices];
}

function chooseHopItem(hop, value) {
  if (value === NEW_ITEM) {
    formFor = hop.key;
    table.redraw();
    return;
  }
  setHopItem(hop, parseItem(value));
}

/** The hop carries another item: both ends change (after asking, if its item def changes). */
function setHopItem(hop, item) {
  formFor = null;
  if (item.type !== hop.item.type && !confirm(replaceQuestion(hop, item))) {
    table.redraw();
    return;
  }
  store.applyOp("set_hop", hopArgs({ ...hop, item }));
}

function replaceQuestion(hop, item) {
  return (
    `Carry ${itemLabel(item)} instead of ${itemLabel(hop.item)}? Both ` +
    `actions' items of ${hop.item.type} are replaced, with their other links.`
  );
}

/** Name and item def of a new item the hop carries (and its ports, from now on). */
function itemForm(hop) {
  const form = dom.element("span", "at-new-item");
  const name = dom.input("name", "");
  const itemDef = dom.input("item def", "");
  itemDef.setAttribute("list", itemDefList().id);
  const add = () =>
    addNewItem(hop, { name: name.value.trim(), type: itemDef.value.trim() });
  for (const field of [name, itemDef])
    field.onkeydown = (event) => formKeys(event, add);
  form.append(
    name,
    itemDef,
    dom.button("OK", "The hop carries this item", add),
    dom.button("Cancel", "", cancelForm),
  );
  return form;
}

function formKeys(event, add) {
  event.stopPropagation(); // Escape here cancels the form, not the dock
  if (event.key === "Enter") add();
  if (event.key === "Escape") cancelForm();
}

function addNewItem(hop, item) {
  if (!state.NAME_RE.test(item.name) || !state.NAME_RE.test(item.type)) {
    alert("The item and its item def each need a legal name.");
    return;
  }
  setHopItem(hop, item);
}

function cancelForm() {
  formFor = null;
  table.redraw();
}

/** The item defs to choose from while typing one (made once). */
function itemDefList() {
  let list = svg.$("atItemDefs");
  if (!list) {
    list = dom.element("datalist");
    list.id = "atItemDefs";
    document.body.append(list);
  }
  list.innerHTML = "";
  for (const name of model.itemDefNames()) list.append(new Option(name));
  return list;
}

// ------------------------------------------------------------------ lines nothing links

/** "⚠ nothing feeds 3 ethernet.cmd", or "1 ethernet.Interrupt ──▶ nobody yet". */
function lineNoteRow(place, line) {
  const row = dom.element("tr", "at-hop");
  const body = dom.element("td", "at-hop-body");
  body.colSpan = 6;
  const here = `${place.index + 1} ${place.step.part}.${portLabel(place.step.partDef, line.port)}`;
  const item = dom.element("span", "", `${line.item} : ${line.itemType}`);
  if (line.direction === EGRESS) {
    body.append(dom.element("span", "at-hop-ends", `${here} ──▶ nobody yet`));
    body.append(item);
  } else {
    body.append(dom.element("span", "at-hop-ends", `? ──▶ ${here}`), item);
    dom.markMissing(body, unfedText(line));
  }
  row.append(dom.element("td", "at-hop-mark", "↳"), body);
  return row;
}

function unfedText(line) {
  return (
    `Nothing feeds ${line.item}: no earlier egress of ${line.itemType} on a ` +
    `port wired to ${line.port}, and no wire from the sheet's own port.`
  );
}

// ------------------------------------------------------------------ helpers

/** The part def at a hop end: its part's, or the sheet's own. */
function partDefOf(end) {
  if (end.part === null) return state.editor.sheet;
  return model.partType(state.editor.sheet, end.part);
}

function portUsage(defName, portId) {
  return (
    model.portsOfDef(defName).find((port) => model.portId(port) === portId) ||
    null
  );
}

/** A port's readable name ("ETH CSR"), else its identifier. */
export function portLabel(defName, portId) {
  const port = portUsage(defName, portId);
  if (!port) return portId;
  return model.shown(port);
}

function isIp(defName) {
  return IP_KINDS.has(model.kindOf(defName || ""));
}
