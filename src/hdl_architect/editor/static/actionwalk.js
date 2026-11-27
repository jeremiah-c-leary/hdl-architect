// HA 2: the walk. A composite action def is built by following the data
// through the sheet, with the dock open (decided with the user, 2026-11-27):
//
// 1. Click the sheet's own port the request comes in by. Its wire leads to
//    a part: that part is where the walk is now (▶ on the footprint).
// 2. Click that part: a menu of the action defs it performs that come in by
//    that port, one entry per exit ("ReceiveFrame → Interrupt"). Picking one
//    adds the action (walk_step, core/action_walk.py, one undo step).
// 3. The exit's wire leads to the next part: ▶ moves there. Repeat until an
//    exit leads back to a sheet port: the path is done.
//
// Where the walk is comes from the model (the last action's exit that
// nothing takes yet), so it survives undo and a reload; only the start,
// before the first action, is kept here.
import * as actions from "./actions.js";
import * as actionHops from "./actionhops.js";
import * as footprint from "./footprint.js";
import * as interaction from "./interaction.js";
import * as menus from "./menus.js";
import * as model from "./model.js";
import * as render from "./render.js";
import * as sequenceView from "./sequenceview.js";
import * as state from "./state.js";
import * as statusbar from "./statusbar.js";
import * as store from "./store.js";

const EGRESS = "out";

/** A walk's start, before its first action: {actionName, port, at}; null if none. */
let start = null;
/** The exit picked last, {step, port}: the walk goes on from it. */
let lastExit = null;

interaction.onPortClick(takeSheetPortClick);
interaction.onPartClick(takePartClick);
footprint.onWalkHere(hereOf);
actions.onActions(showWalkHint);
sequenceView.onDockOpen(showWalkHint);

/** The action being walked: the dock's, while it is open; null if none. */
function walkedAction() {
  const name = sequenceView.dockedAction();
  if (!name) return null;
  return actions.sheetAction(name);
}

// ------------------------------------------------------------------ where the walk is

/**
 * Where the walk is: {from, at, fromEnd}. `from` is {step, port}: the last
 * action and its exit, or step null and the sheet's own port; `at` is
 * {part, port}, where it arrives. Null when it is nowhere (not started, or
 * done).
 */
export function walkHere(action) {
  if (start && start.actionName === action.name)
    return {
      from: { step: null, port: start.port },
      at: start.at,
      fromEnd: start.port,
    };
  const exit = openExit(action);
  if (!exit) return null;
  const arrival = farEndOf(exit.end);
  if (!arrival || arrival.part === null) return null; // back at the sheet: done
  const from = { step: exit.step, port: exit.end.port };
  return { from, at: arrival, fromEnd: model.endStr(exit.end) };
}

/** The last action's exit that nothing takes yet: the one picked last, else its first. */
function openExit(action) {
  const last = action.steps.at(-1);
  if (!last || !last.part) return null;
  const open = last.items.filter(
    (line) =>
      line.direction === EGRESS && line.port && !isTaken(action, last, line),
  );
  if (!open.length) return null;
  const picked = open.find((line) => isLastExit(last, line.port)) || open[0];
  const end = { kind: "part", part: last.part, port: picked.port };
  return { step: last.name, end };
}

function isTaken(action, step, line) {
  return action.flows.some(
    (flow) => flow.source === step.name && flow.sourceItem === line.item,
  );
}

function isLastExit(step, port) {
  return lastExit && lastExit.step === step.name && lastExit.port === port;
}

/** Where the one wire from a port leads: {part, port}; part null at the sheet's own port. */
function farEndOf(end) {
  const here = model.endStr(end);
  const ends = [];
  for (const wire of model.wiresOf(state.editor.sheet).wires) {
    if (model.endStr(wire.a) === here) ends.push(wire.b);
    else if (model.endStr(wire.b) === here) ends.push(wire.a);
  }
  if (ends.length !== 1) return null; // none, or more than one (not walked)
  const far = ends[0];
  return { part: far.kind === "edge" ? null : far.part, port: far.port };
}

/** For the footprint: the part the walk is at, and the wire that leads there. */
function hereOf(action) {
  const here = walkHere(action);
  if (!here) return null;
  const atEnd = `${here.at.part}.${here.at.port}`;
  return { part: here.at.part, wire: footprint.endsKey(here.fromEnd, atEnd) };
}

// ------------------------------------------------------------------ the clicks

/** A click on the sheet's own port, with the dock open: the walk starts there. */
function takeSheetPortClick(end) {
  const action = walkedAction();
  if (!action || end.kind !== "edge") return false;
  const far = farEndOf(end);
  if (!far || far.part === null) {
    statusbar.showHint(
      `${end.port} has no one wire to a part: no walk from it.`,
    );
    return true;
  }
  start = { actionName: action.name, port: end.port, at: far };
  render.render();
  showWalkHint();
  return true;
}

/** A click on the part the walk is at: what it can do with what comes in. */
function takePartClick(partName, event) {
  const action = walkedAction();
  if (!action) return false;
  const here = walkHere(action);
  if (!here || here.at.part !== partName) return false;
  const entries = menuEntries(action, here);
  // After this click is done: the page hides menus on a click.
  setTimeout(() => menus.menu(event.clientX, event.clientY, entries));
  return true;
}

function menuEntries(action, here) {
  const defName = model.partType(state.editor.sheet, here.at.part);
  const port = actionHops.portLabel(defName, here.at.port);
  const entries = [{ head: `${here.at.part}: in by ${port}` }];
  for (const choice of choicesAt(defName, here.at.port))
    entries.push({
      label: choiceLabel(defName, choice),
      act: () => walkTo(action, here, choice),
    });
  if (entries.length === 1)
    entries.push({ head: "nothing it performs comes in by this port" });
  return entries;
}

/** "ReceiveFrame → Interrupt": the action def, and the port it leaves by. */
function choiceLabel(defName, choice) {
  if (!choice.exit) return `${choice.actionDef} (leaves by no port)`;
  return `${choice.actionDef} → ${actionHops.portLabel(defName, choice.exit)}`;
}

/** The action defs the part def performs that come in by `port`, one per exit. */
function choicesAt(defName, port) {
  const definition = model.partDef(defName);
  if (!definition) return [];
  const flows = definition.flows || [];
  const choices = [];
  for (const perform of definition.performs || []) {
    if (comesInBy(flows, perform.name, port))
      choices.push(...exitsOf(defName, flows, perform));
  }
  return choices;
}

/** `flow from port.item to perform.item;`: an item of the perform comes in by the port. */
function comesInBy(flows, performName, port) {
  return flows.some(
    (flow) => head(flow.from) === port && head(flow.to) === performName,
  );
}

/** The ports the perform's items leave by: `flow from perform.item to port.item;`. */
function exitsOf(defName, flows, perform) {
  const actionDef = model.unqualifiedName(perform.type);
  const ports = new Set(model.portsOfDef(defName).map(model.portId));
  const exits = flows
    .filter((flow) => head(flow.from) === perform.name)
    .map((flow) => head(flow.to))
    .filter((port) => ports.has(port));
  const unique = [...new Set(exits)];
  if (!unique.length) return [{ actionDef, exit: null }];
  return unique.map((exit) => ({ actionDef, exit }));
}

function head(ref) {
  return ref.split(".")[0];
}

/** Add the picked action where the walk is (one undo step). */
function walkTo(action, here, choice) {
  const args = {
    sheet: state.editor.sheet,
    perform: action.name,
    from: here.from,
    at: here.at,
    action: choice.actionDef,
  };
  if (choice.exit) args.exit = choice.exit;
  store.applyOp("walk_step", args, (result) => {
    start = null;
    lastExit = { step: result.data.step, port: choice.exit };
  });
}

// ------------------------------------------------------------------ the hint

/** Under the sheet: what to click next. */
function showWalkHint() {
  const action = walkedAction();
  if (!action) return;
  statusbar.showHint(walkHint(action));
}

function walkHint(action) {
  const here = walkHere(action);
  if (here) {
    const defName = model.partType(state.editor.sheet, here.at.part);
    const port = actionHops.portLabel(defName, here.at.port);
    return `▶ ${here.at.part}: click it to choose what it does with what comes in by ${port}.`;
  }
  if (!action.steps.length)
    return "Click the sheet port the request comes in by, to start the walk.";
  return "The walk is done (or its last action leaves by no wire). Click a sheet port to start another path.";
}
