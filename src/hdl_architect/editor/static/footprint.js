// HA 2: an action's footprint on the sheet: the parts that perform its steps
// (with their step numbers) and the wires its items travel on stand out, the
// rest is dimmed, and an item with no wire to travel on is a red dashed line
// between its two ports. render.js asks this module what to show.
import * as actions from "./actions.js";
import * as model from "./model.js";
import * as render from "./render.js";
import * as state from "./state.js";
import * as svg from "./svg.js";

/** The footprint shown: {sheet, actionName}; null when none is. */
let shown = null;
/** Where the walk is (actionwalk.js): (action) => {part, wire} or null. */
let walkHere = () => null;

svg.$("footprintClose").onclick = hideFootprint;

/** The walk tells the footprint where it is: that part and wire light up too, with ▶. */
export function onWalkHere(provider) {
  walkHere = provider;
}

export function showFootprint(actionName) {
  shown = { sheet: state.editor.sheet, actionName };
  render.render();
}

export function hideFootprint() {
  shown = null;
  render.render();
}

export function isShowing(actionName) {
  return currentAction() !== null && shown.actionName === actionName;
}

/** The action whose footprint is on the open sheet, if any. */
function currentAction() {
  if (!shown || shown.sheet !== state.editor.sheet) return null;
  return actions.sheetAction(shown.actionName);
}

/**
 * What the footprint shows on the open sheet, or null:
 * - parts: {part name: [its step numbers]};
 * - wires: the keys (see wireKey) of the wires its items travel on;
 * - missing: the items with no wire, {sourceEnd, targetEnd, text};
 * - here: the part the walk is at (▶), or null.
 */
export function currentFootprint() {
  const action = currentAction();
  showBar(action);
  if (!action) return null;
  const shownNow = {
    parts: stepNumbersByPart(action.steps),
    wires: new Set(action.flows.filter(isCarried).map(flowKey)),
    missing: action.flows
      .filter((flow) => flow.wired === false)
      .map(missingLine),
    here: null,
  };
  addWalkHere(shownNow, walkHere(action));
  return shownNow;
}

/** The part the walk is at lights up (with ▶), and the wire that leads there. */
function addWalkHere(shownNow, here) {
  if (!here) return;
  shownNow.here = here.part;
  shownNow.parts[here.part] = shownNow.parts[here.part] || [];
  shownNow.wires.add(here.wire);
}

function stepNumbersByPart(steps) {
  const numbers = {};
  steps.forEach((step, index) => {
    if (!step.part) return;
    numbers[step.part] = numbers[step.part] || [];
    numbers[step.part].push(index + 1);
  });
  return numbers;
}

/** A flow carried by a wire between two different places. */
function isCarried(flow) {
  return flow.wired === true && flow.sourceEnd !== flow.targetEnd;
}

function flowKey(flow) {
  return endsKey(flow.sourceEnd, flow.targetEnd);
}

/** The same key for a wire, whichever end comes first. */
export function endsKey(firstEnd, secondEnd) {
  return [firstEnd, secondEnd].sort().join("|");
}

function missingLine(flow) {
  const text =
    `${model.itemText(flow.sourceItem, flow.itemType)}: no wire from ` +
    `${flow.sourceEnd} to ${flow.targetEnd}`;
  return { sourceEnd: flow.sourceEnd, targetEnd: flow.targetEnd, text };
}

/** Above the sheet: "Footprint: readTemperature" and a button to hide it. */
function showBar(action) {
  const bar = svg.$("footprintBar");
  bar.hidden = !action;
  if (action)
    svg.$("footprintTitle").textContent =
      `Footprint: ${action.name} : ${action.actionDef}`;
}

// A new report: the footprint shown follows it.
actions.onActions(() => {
  if (shown) render.render();
});
