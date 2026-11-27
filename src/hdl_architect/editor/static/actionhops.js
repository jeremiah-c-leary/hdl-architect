// HA 2: hops in the actions table. A hop is one item going from one action
// to the next over one wire: a connection row of the table (in SysML a
// succession flow between the two actions' items, over the connection
// between their parts' ports; core/action_hops.py). The item is chosen
// once, on the hop, so the egress and the ingress it joins cannot disagree.
//
// The table is built by clicking source ports on the sheet while the Actions
// tab is open (decided with the user, 2026-11-26): a click on a port makes a
// hop over each wire from it, from the latest action of that port's part, to
// a new action (a draft row) on the part at the far end. A hop is saved, as
// one undo step, once its item and its new actions' action defs are chosen.
// An IP's items are fixed: a hop with an IP end offers only that IP's items.
import * as actions from "./actions.js";
import * as dom from "./dom.js";
import * as interaction from "./interaction.js";
import * as model from "./model.js";
import * as state from "./state.js";
import * as statusbar from "./statusbar.js";
import * as store from "./store.js";
import * as svg from "./svg.js";

const NEW_ITEM = "(new item)";
const SOURCE = "source";
const INGRESS = "in";
const EGRESS = "out";
/** Part kinds that bring their own actions (core/action_ops.py, IP_KINDS). */
const IP_KINDS = new Set(["VendorIp", "HardMacro"]);

/**
 * Rows and hops not saved yet, in the order they show: {draft} or {hop}.
 * A draft is {part, actionDef, saved} (saved: its action's name, once made).
 * A hop is {source, target, item, failed}; each end is {part, port} (part
 * null: the sheet's own port) and, at a part, its {step} or its {draft}.
 */
const pending = [];
/** The performed action the table shows, and how to draw the table again. */
const table = { action: null, redraw: () => {} };
/** The hop whose "New item…" form is open: a pending hop, or a saved hop's key. */
let formFor = null;
/** A hop is being saved: the next one waits for it. */
let saving = false;

interaction.onPortClick(takePortClick);

// ------------------------------------------------------------------ what is pending

/** The table shows `actionName`; what was pending for another action goes. */
export function showHopsOf(actionName, redraw) {
  if (actionName !== table.action) {
    pending.length = 0;
    formFor = null;
  }
  table.action = actionName;
  table.redraw = redraw;
}

export function pendingEntries() {
  return pending;
}

function pendingHops() {
  return pending.filter((entry) => entry.hop).map((entry) => entry.hop);
}

/** The draft rows, in order (none saved: a saved one leaves the list). */
export function pendingDrafts() {
  return pending.filter((entry) => entry.draft).map((entry) => entry.draft);
}

function newDraft(part) {
  return { part, actionDef: "", saved: null };
}

/** [+ Action]: a draft row of its own, to choose its part usage first. */
export function addFreeDraft() {
  pending.push({ draft: newDraft("") });
}

/** The row number a draft shows: after the saved actions. */
export function draftNumber(draft) {
  const saved = actions.sheetAction(table.action).steps.length;
  return saved + pendingDrafts().indexOf(draft) + 1;
}

/** A draft that is an end of a hop is saved with that hop. */
export function isHopDraft(draft) {
  return pendingHops().some((hop) => usesDraft(hop, draft));
}

function usesDraft(hop, draft) {
  return hop.source.draft === draft || hop.target.draft === draft;
}

/** A hop's draft has its action def: saved with the hop when it can be. */
export function chooseHopDraftActionDef(draft, actionDef) {
  draft.actionDef = actionDef;
  retryAll();
  table.redraw();
  savePendingHops();
}

/** Forget a draft (made into an action, or discarded) and the hops to it. */
export function forgetDraft(draft) {
  removeEntry(draft);
  for (const hop of pendingHops().filter((one) => usesDraft(one, draft)))
    forgetHop(hop);
}

export function discardDraft(draft) {
  forgetDraft(draft);
  table.redraw();
}

function discardHop(hop) {
  forgetHop(hop);
  table.redraw();
}

/** Forget a hop, and the draft made for its far end if nothing else uses it. */
function forgetHop(hop) {
  removeEntry(hop);
  const draft = hop.target.draft;
  if (draft && !draft.saved && !isHopDraft(draft)) removeEntry(draft);
}

function removeEntry(thing) {
  const index = pending.findIndex(
    (entry) => entry.hop === thing || entry.draft === thing,
  );
  if (index >= 0) pending.splice(index, 1);
}

/** The ports of pending hops at a row ({step} or {draft}), as text. */
export function pendingPortsOf(row, direction) {
  const ends = pendingHops().map((hop) =>
    direction === EGRESS ? hop.source : hop.target,
  );
  return ends
    .filter((end) => isEndOf(end, row))
    .map((end) => portLabel(partDefOf(end), end.port));
}

function isEndOf(end, row) {
  if (row.draft) return end.draft === row.draft;
  return stepOf(end) === row.step;
}

// ------------------------------------------------------------------ a click on a port

/** A click on a port of the sheet while the Actions tab is open: a hop over each of its wires. */
function takePortClick(end) {
  if (!isDockOpen()) return false;
  const farEnds = farEndsOf(end);
  if (!farEnds.length) {
    statusbar.showHint(`${model.endStr(end)} has no wire: no hop to follow.`);
    return true;
  }
  const source = sourceOf(end);
  for (const far of farEnds) addHop(source, far);
  table.redraw();
  scrollToNewRows();
  savePendingHops();
  return true;
}

/** The dock is open, on either tab: a click on a port adds a hop. */
function isDockOpen() {
  if (!table.action) return false;
  return !svg.$("sequenceView").hidden;
}

/** The ends of the wires from a port: what a hop from it can reach. */
function farEndsOf(end) {
  const here = model.endStr(end);
  const ends = [];
  for (const wire of model.wiresOf(state.editor.sheet).wires) {
    if (model.endStr(wire.a) === here) ends.push(wire.b);
    else if (model.endStr(wire.b) === here) ends.push(wire.a);
  }
  return ends;
}

/** Where a hop from this port starts: the sheet's own port, else the latest row of its part (a new draft if it has none). */
function sourceOf(end) {
  if (end.kind === "edge") return { part: null, port: end.port };
  return { part: end.part, port: end.port, ...latestRowOn(end.part) };
}

function latestRowOn(part) {
  const draft = pendingDrafts()
    .filter((candidate) => candidate.part === part)
    .pop();
  if (draft) return { draft };
  const step = actions
    .sheetAction(table.action)
    .steps.filter((candidate) => candidate.part === part)
    .pop();
  if (step) return { step: step.name };
  const made = newDraft(part);
  pending.push({ draft: made });
  return { draft: made };
}

function addHop(source, far) {
  if (far.kind === "edge" && source.part === null) return; // the sheet to itself
  const target = targetOf(far);
  const hop = { source, target, item: null, failed: false };
  hop.item = onlyChoice(hop);
  pending.push({ hop });
  if (target.draft) pending.push({ draft: target.draft });
}

/** The far end of a hop: the sheet's own port, or a new action on that part. */
function targetOf(far) {
  if (far.kind === "edge") return { part: null, port: far.port };
  return { part: far.part, port: far.port, draft: newDraft(far.part) };
}

/** The table's new rows are at its end; the Sequence tab's strip is at the top. */
function scrollToNewRows() {
  const body = svg.$("actionsTable").parentElement;
  if (svg.$("actionsTable").hidden) body.scrollTop = 0;
  else body.scrollTop = body.scrollHeight;
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

function onlyChoice(hop) {
  const choices = itemChoices(hop);
  if (choices.length === 1) return choices[0];
  return null;
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

// ------------------------------------------------------------------ saving

/** Why a hop cannot be saved yet; "" when it can. */
function waitsFor(hop) {
  if (!hop.item) return "Choose the item it carries.";
  return endWaitsFor(hop.source, hop) || endWaitsFor(hop.target, hop);
}

function endWaitsFor(end, hop) {
  const draft = end.draft;
  if (!draft || draft.saved) return "";
  if (!draft.actionDef) return `Choose row ${draftNumber(draft)}'s action def.`;
  if (madeByAnother(draft, hop))
    return `Waits for the hop into row ${draftNumber(draft)}.`;
  return "";
}

/** The draft is the far end of another hop, which makes it. */
function madeByAnother(draft, hop) {
  return pendingHops().some(
    (other) => other !== hop && other.target.draft === draft,
  );
}

/** Save the first hop that can be: one at a time, in order. */
export async function savePendingHops() {
  if (saving) return;
  const hop = pendingHops().find(
    (candidate) => !candidate.failed && !waitsFor(candidate),
  );
  if (!hop) return;
  saving = true;
  const result = await store.applyOp("set_hop", hopArgs(hop), (done) =>
    hopSaved(hop, done),
  );
  saving = false;
  if (!result) hop.failed = true;
  table.redraw();
  if (result) savePendingHops();
}

/** After a refusal, a change of the user's tries every hop again. */
function retryAll() {
  for (const hop of pendingHops()) hop.failed = false;
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

/** A hop end as set_hop takes it: {step, port, item?, new?}. */
function endArgs(end) {
  const args = { step: stepOf(end), port: end.port };
  if (end.item) args.item = end.item;
  if (end.draft && !end.draft.saved)
    args.new = { part: end.draft.part, action: end.draft.actionDef };
  return args;
}

/** The action at a hop end; null at the sheet, or while its draft is not saved. */
function stepOf(end) {
  if (end.draft) return end.draft.saved;
  return end.step || null;
}

/** The hop's new actions are made: their drafts know their names, and go. */
function hopSaved(hop, result) {
  const made = result.data || {};
  nameDraft(hop.source, made.source);
  nameDraft(hop.target, made.target);
  removeEntry(hop);
  for (const draft of pendingDrafts().filter((one) => one.saved))
    removeEntry(draft);
}

function nameDraft(end, name) {
  if (end.draft && name) end.draft.saved = name;
}

// ------------------------------------------------------------------ the connection rows

/** The connection rows before a saved action: the hops into it, and its ingresses nothing feeds. */
export function hopRowsBefore(place) {
  const name = place.step.name;
  const rows = place.action.flows
    .filter((flow) => flow.target === name)
    .map((flow) => savedHopRow(place.action, flow));
  for (const line of unlinkedLines(place, INGRESS))
    rows.push(lineNoteRow(place, line));
  return rows;
}

/** The connection rows after a saved action: its hops out to the sheet, and its egresses nobody takes. */
export function hopRowsAfter(place) {
  const name = place.step.name;
  const rows = place.action.flows
    .filter((flow) => flow.source === name && flow.target === null)
    .map((flow) => savedHopRow(place.action, flow));
  for (const line of unlinkedLines(place, EGRESS))
    rows.push(lineNoteRow(place, line));
  return rows;
}

/** A pending hop's row. */
export function pendingHopRow(hop, action) {
  return hopRow(hop, action);
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
    saved: true,
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
  const mark = dom.element("td", "at-hop-mark", "↳");
  if (!hop.saved)
    mark.append(dom.button("✕", "Discard this hop", () => discardHop(hop)));
  const body = dom.element("td", "at-hop-body");
  body.colSpan = 6;
  body.append(endsText(hop, action), dom.element("span", "at-muted", "item"));
  body.append(itemPart(hop), waitText(hop));
  row.append(mark, body);
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
  return `${rowNumberOf(end, action)} ${end.part}.${port}`;
}

function rowNumberOf(end, action) {
  const step = stepOf(end);
  if (!step) return draftNumber(end.draft);
  return action.steps.findIndex((candidate) => candidate.name === step) + 1;
}

/** Why a pending hop is not saved yet (nothing for a saved one). */
function waitText(hop) {
  const note = dom.element("span", "at-muted at-wait");
  if (hop.saved) return note;
  if (hop.failed) {
    note.textContent = "Not saved: see the note under the sheet.";
    return note;
  }
  note.textContent = waitsFor(hop) || "saving…";
  return note;
}

// ------------------------------------------------------------------ choosing a hop's item

function itemPart(hop) {
  if (formFor !== null && formFor === formOwner(hop)) return itemForm(hop);
  return itemPicker(hop);
}

function formOwner(hop) {
  if (hop.saved) return hop.key;
  return hop;
}

function itemPicker(hop) {
  const choices = withCurrent(itemChoices(hop), hop.item);
  const options = [["", "choose…"]];
  for (const item of choices) options.push([itemValue(item), itemLabel(item)]);
  if (canMakeItem(hop)) options.push([NEW_ITEM, "New item…"]);
  const select = dom.picker(options, hop.item ? itemValue(hop.item) : "");
  select.dataset.role = `${hopRole(hop)}|item`;
  select.onchange = () => chooseHopItem(hop, select.value);
  return select;
}

/** "receiveFrame.int>readFrame.int" for a saved hop; "hop0", ... for pending ones. */
function hopRole(hop) {
  if (hop.saved) return hop.key;
  return `hop${pendingHops().indexOf(hop)}`;
}

function withCurrent(choices, current) {
  if (!current) return choices;
  if (choices.some((item) => itemValue(item) === itemValue(current)))
    return choices;
  return [current, ...choices];
}

function chooseHopItem(hop, value) {
  if (value === NEW_ITEM) {
    formFor = formOwner(hop);
    table.redraw();
    return;
  }
  if (value) setHopItem(hop, parseItem(value));
}

function setHopItem(hop, item) {
  formFor = null;
  if (hop.saved) {
    changeSavedHop(hop, item);
    return;
  }
  hop.item = item;
  retryAll();
  table.redraw();
  savePendingHops();
}

/** A saved hop carries another item: both ends change (after asking, if its item def changes). */
function changeSavedHop(hop, item) {
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
