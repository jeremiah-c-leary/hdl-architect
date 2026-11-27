// HA 2: the sequence view of a performed action (HA 1's Feature Mapping
// Visualization): a lifeline per part that performs a step, the steps in
// order down the page, and an arrow for each item passing between them,
// solid where a wire carries it, red and dashed where none does.
//
// ▶ on a lifeline expands it: a part whose steps are broken down into steps
// on its own parts becomes those parts' lifelines, in a bracket, and each of
// its steps becomes its sub-steps (1 becomes 1.1, 1.2). An item that entered
// the part now goes on to the sub-step that takes it. ▼ folds it back.
//
// The Actions tab shows the same action as a table to edit (actionstable.js).
import * as actions from "./actions.js";
import * as actionsTable from "./actionstable.js";
import * as footprint from "./footprint.js";
import * as model from "./model.js";
import * as state from "./state.js";
import * as svg from "./svg.js";

/** The action shown (its perform's name on the open sheet), or null. */
let shownAction = null;
/** Expanded lifelines, by lane key: "ethernet", "ethernet.mac". */
const expandedLanes = new Set();
/** The tab shown: the sequence diagram or the actions table. */
const SEQUENCE_TAB = "sequence";
const ACTIONS_TAB = "actions";
let shownTab = SEQUENCE_TAB;

/** The boundary: the sheet's own ports, the leftmost lifeline. */
const BOUNDARY = "(boundary)";

const SIZE = {
  LEFT: 20,
  LANE_W: 190,
  HEAD_H: 40, // a lifeline's heading
  GROUP_H: 22, // an expanded lifeline's bracket title, per level
  STEP_W: 170,
  STEP_H: 32,
  STEP_ROW: 44,
  MESSAGE_ROW: 30,
  SELF_LOOP: 24, // an item that stays in one part
};

// ------------------------------------------------------------------ open and close

export function openSequence(actionName) {
  openDock(actionName, SEQUENCE_TAB);
}

/** The same view, on the Actions tab: the table to edit the action. */
export function openActions(actionName) {
  openDock(actionName, ACTIONS_TAB);
}

/** Who wants to know when the dock opens (the walk, for its hint). */
const dockListeners = [];

export function onDockOpen(listener) {
  dockListeners.push(listener);
}

/** Open the dock on a tab; the action's footprint lights the sheet above. */
function openDock(actionName, tab) {
  shownAction = actionName;
  svg.$("sequenceView").hidden = false;
  footprint.showFootprint(actionName);
  showTab(tab);
  for (const listener of dockListeners) listener();
}

/** The action the open dock shows; null while it is closed. */
export function dockedAction() {
  if (!isOpen()) return null;
  return shownAction;
}

export function showTab(tab) {
  shownTab = tab;
  const onActions = tab === ACTIONS_TAB;
  svg.$("seqSvg").classList.toggle("seq-hidden", onActions); // no `hidden` on SVG
  svg.$("actionsTable").hidden = !onActions;
  svg.$("seqTabSequence").classList.toggle("cur", !onActions);
  svg.$("seqTabActions").classList.toggle("cur", onActions);
  svg.$("seqExpandAll").hidden = onActions;
  svg.$("seqCollapseAll").hidden = onActions;
  drawShownTab();
}

function drawShownTab() {
  svg.$("seqTitle").textContent = titleText(actions.sheetAction(shownAction));
  if (shownTab === ACTIONS_TAB) {
    actionsTable.renderActionsTable(shownAction);
    return;
  }
  drawSequence();
}

export function closeSequence() {
  svg.$("sequenceView").hidden = true;
  if (footprint.isShowing(shownAction)) footprint.hideFootprint();
}

function isOpen() {
  return !svg.$("sequenceView").hidden;
}

/** Expand every lifeline that can be, all the way down. */
export function expandAll() {
  const action = actions.sheetAction(shownAction);
  if (!action) return;
  for (const lane of expandableLanes(action.steps, null))
    expandedLanes.add(lane);
  showTab(SEQUENCE_TAB);
}

export function collapseAll() {
  expandedLanes.clear();
  showTab(SEQUENCE_TAB);
}

export function toggleLane(lane) {
  if (expandedLanes.has(lane)) expandedLanes.delete(lane);
  else expandedLanes.add(lane);
  showTab(SEQUENCE_TAB);
}

/** The footprint on the sheet above, on or off; the dock stays open. */
function toggleFootprint() {
  if (footprint.isShowing(shownAction)) footprint.hideFootprint();
  else footprint.showFootprint(shownAction);
}

svg.$("seqClose").onclick = closeSequence;
svg.$("seqExpandAll").onclick = expandAll;
svg.$("seqCollapseAll").onclick = collapseAll;
svg.$("seqFootprint").onclick = toggleFootprint;
svg.$("seqTabSequence").onclick = () => showTab(SEQUENCE_TAB);
svg.$("seqTabActions").onclick = () => showTab(ACTIONS_TAB);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && isOpen()) closeSequence();
});
actions.onActions(() => {
  if (!isOpen()) return;
  if (actions.sheetAction(shownAction)) drawShownTab();
  else closeSequence(); // another sheet opened: it does not perform this action
});

// ------------------------------------------------------------------ the scene

/**
 * What is drawn, worked out before drawing: the steps shown (an expanded
 * step is replaced by its sub-steps), the lifelines left to right, the
 * brackets of the expanded ones, and the items passing between steps.
 */
export function sceneOf(action) {
  const laneDefs = new Map(); // an expanded lifeline's part def
  const steps = shownSteps(action.steps, null, laneDefs);
  const byKey = new Map(steps.map((placed) => [placed.key, placed]));
  const scene = { steps, byKey, laneDefs };
  scene.lanes = [BOUNDARY, ...laneOrder(steps)];
  scene.groups = bracketsOf(scene.lanes);
  scene.messages = messagesOf(scene, {
    steps: action.steps,
    flows: action.flows,
  });
  return scene;
}

/**
 * The steps as shown, each placed: its key, number and lifeline. Notes the
 * part def of each expanded lifeline in `laneDefs`.
 */
function shownSteps(steps, parent, laneDefs) {
  const placed = [];
  steps.forEach((step, index) => {
    const here = placedStep(step, index, parent);
    if (!isExpanded(here)) {
      placed.push(here);
      return;
    }
    laneDefs.set(here.lane, step.partDef);
    placed.push(...shownSteps(step.steps, here, laneDefs));
  });
  return placed;
}

function placedStep(step, index, parent) {
  return {
    step,
    key: joined(parent && parent.key, step.name), // "receiveFrame.rxMac"
    number: joined(parent && parent.number, String(index + 1)), // "1.1"
    lane: joined(parent && parent.lane, step.part || "(no part)"),
  };
}

function joined(prefix, name) {
  if (!prefix) return name;
  return `${prefix}.${name}`;
}

function isExpanded(placed) {
  return placed.step.status === "decomposed" && expandedLanes.has(placed.lane);
}

/** Every lifeline with broken-down steps on it, at every level. */
function expandableLanes(steps, parent) {
  const lanes = new Set();
  steps.forEach((step, index) => {
    const here = placedStep(step, index, parent);
    if (step.status !== "decomposed") return;
    lanes.add(here.lane);
    for (const inner of expandableLanes(step.steps, here)) lanes.add(inner);
  });
  return lanes;
}

/**
 * The lifelines in order of first use, the parts of an expanded lifeline
 * kept together where it was: compare lanes level by level, by when each
 * level was first used.
 */
function laneOrder(steps) {
  const firstUse = new Map();
  const allPrefixes = steps.flatMap((placed) => prefixesOf(placed.lane));
  for (const prefix of allPrefixes)
    if (!firstUse.has(prefix)) firstUse.set(prefix, firstUse.size);
  const lanes = [...new Set(steps.map((placed) => placed.lane))];
  const rank = (lane) => prefixesOf(lane).map((prefix) => firstUse.get(prefix));
  return lanes.sort((first, second) => compareRanks(rank(first), rank(second)));
}

/** "a.b.c" -> ["a", "a.b", "a.b.c"]. */
function prefixesOf(lane) {
  const segments = lane.split(".");
  return segments.map((_segment, index) =>
    segments.slice(0, index + 1).join("."),
  );
}

function compareRanks(first, second) {
  for (let index = 0; index < Math.min(first.length, second.length); index++)
    if (first[index] !== second[index]) return first[index] - second[index];
  return first.length - second.length;
}

/** The lifeline of an expanded part, or of one of its parts. */
function isInside(other, lane) {
  return other === lane || other.startsWith(`${lane}.`);
}

/**
 * A bracket over the lifelines of each expanded part: {lane, first, last,
 * depth}, first and last being the indexes of the lifelines inside it.
 */
function bracketsOf(lanes) {
  const groups = [];
  for (const lane of expandedLanes) {
    const inside = lanes
      .map((other, index) => ({ other, index }))
      .filter(({ other }) => isInside(other, lane));
    if (!inside.length) continue;
    const first = inside[0].index;
    const last = inside[inside.length - 1].index;
    groups.push({ lane, first, last, depth: lane.split(".").length });
  }
  return groups;
}

// ------------------------------------------------------------------ items between steps

/**
 * The arrows: each item passing between two shown steps (or the boundary).
 * An item into or out of an expanded step goes on to the sub-step that
 * takes or gives it, through the expanded action's own items.
 */
function messagesOf(scene, level) {
  const drawn = level.flows.filter((flow) => isDrawnAt(level, flow));
  const messages = drawn.map((flow) => messageOf(scene, level, flow));
  for (const step of level.steps) {
    const key = joined(level.key, step.name);
    if (isHiddenByExpanding(scene, step, key))
      messages.push(...messagesOf(scene, innerLevel(step, key)));
  }
  return messages;
}

/**
 * At the top every flow is an arrow; inside an expanded step, only those
 * between its sub-steps (the others continue an arrow from outside).
 */
function isDrawnAt(level, flow) {
  if (!level.key) return true;
  return flow.source !== null && flow.target !== null;
}

function isHiddenByExpanding(scene, step, key) {
  return step.status === "decomposed" && !scene.byKey.has(key);
}

/** The steps and flows inside an expanded step. */
function innerLevel(step, key) {
  return { key, steps: step.steps, flows: step.flows };
}

function messageOf(scene, level, flow) {
  const source = resolve(
    scene,
    { level, step: flow.source, item: flow.sourceItem },
    "out",
  );
  const target = resolve(
    scene,
    { level, step: flow.target, item: flow.targetItem },
    "in",
  );
  const flows = [...source.flows, flow, ...target.flows];
  return { flow, source: source.key, target: target.key, flows };
}

/**
 * Where an item leaves ("out") or enters ("in") a step, as shown: the
 * step's key, or, if the step is expanded, the sub-step's (found through
 * the expanded action's own item). Returns {key, flows: the inner flows
 * on the way}.
 */
function resolve(scene, end, way) {
  if (end.step === null) return { key: BOUNDARY, flows: [] };
  const key = joined(end.level.key, end.step);
  const step = end.level.steps.find((candidate) => candidate.name === end.step);
  if (scene.byKey.has(key) || !step) return { key, flows: [] };
  const inner = innerFlow(step, end.item, way);
  if (!inner) return { key: shownInside(scene, key, way), flows: [] };
  const level = innerLevel(step, key);
  const deeper = resolve(scene, innerEnd(level, inner, way), way);
  return { key: deeper.key, flows: [inner, ...deeper.flows] };
}

/** In the expanded step: the flow from (or to) its own item `item`. */
function innerFlow(step, item, way) {
  if (way === "out")
    return step.flows.find(
      (flow) => flow.target === null && flow.targetItem === item,
    );
  return step.flows.find(
    (flow) => flow.source === null && flow.sourceItem === item,
  );
}

function innerEnd(level, inner, way) {
  if (way === "out")
    return { level, step: inner.source, item: inner.sourceItem };
  return { level, step: inner.target, item: inner.targetItem };
}

/**
 * No inner flow says which sub-step takes or gives the item: it enters the
 * first sub-step shown, and leaves the last.
 */
function shownInside(scene, key, way) {
  const inside = scene.steps.filter((placed) =>
    placed.key.startsWith(`${key}.`),
  );
  if (!inside.length) return key;
  if (way === "out") return inside[inside.length - 1].key;
  return inside[0].key;
}

/** Carried by wires all the way (true), missing one (false), or not known. */
export function wiredState(message) {
  const states = message.flows.map((flow) => flow.wired);
  if (states.includes(false)) return false;
  if (states.includes(null)) return null;
  return true;
}

/** The rows down the page: items into a step, the step, items out to the edge. */
function rowsOf(scene) {
  const rows = [];
  for (const placed of scene.steps) {
    const into = scene.messages.filter(
      (message) => message.target === placed.key,
    );
    rows.push(...into.map((message) => ({ message })));
    rows.push({ placed });
    const out = scene.messages.filter(
      (message) => message.source === placed.key && message.target === BOUNDARY,
    );
    rows.push(...out.map((message) => ({ message })));
  }
  return rows;
}

// ------------------------------------------------------------------ drawing

function drawSequence() {
  const drawing = svg.$("seqSvg");
  drawing.innerHTML = "";
  const action = actions.sheetAction(shownAction);
  if (!action) return;
  const scene = sceneOf(action);
  const layout = layoutOf(scene);
  drawing.setAttribute("width", layout.width);
  drawing.setAttribute("height", layout.height);
  drawArrowHeads(drawing);
  const canvas = { drawing, scene, layout };
  drawBrackets(canvas);
  scene.lanes.forEach((lane, index) => drawLifeline(canvas, lane, index));
  drawRows(canvas);
  if (!action.steps.length) drawNoSteps(canvas);
}

function titleText(action) {
  if (!action) return "Sequence";
  return `${action.name} : ${action.actionDef}, performed by ${state.editor.sheet}`;
}

/** Where things go: the lifelines' x, the top of the rows, the size. */
function layoutOf(scene) {
  const depth = Math.max(0, ...scene.groups.map((group) => group.depth));
  const top = SIZE.LEFT + depth * SIZE.GROUP_H + SIZE.HEAD_H + 16;
  const rows = rowsOf(scene);
  const rowsHeight = rows.reduce((total, row) => total + rowHeight(row), 0);
  return {
    depth,
    top,
    rows,
    width: SIZE.LEFT * 2 + scene.lanes.length * SIZE.LANE_W,
    height: top + Math.max(rowsHeight, SIZE.STEP_ROW) + SIZE.LEFT,
  };
}

function rowHeight(row) {
  if (row.placed) return SIZE.STEP_ROW;
  return SIZE.MESSAGE_ROW;
}

function laneX(index) {
  return SIZE.LEFT + index * SIZE.LANE_W + SIZE.LANE_W / 2;
}

/** Arrow heads for the items: one for a wired item, one for a missing wire. */
function drawArrowHeads(drawing) {
  const defs = svg.el("defs", {}, drawing);
  for (const name of ["seq-head", "seq-head-missing"]) {
    const marker = svg.el(
      "marker",
      { id: name, viewBox: "0 0 10 10", refX: 10, refY: 5, markerWidth: 7 },
      defs,
    );
    marker.setAttribute("markerHeight", 7);
    marker.setAttribute("orient", "auto");
    svg.el("path", { d: "M0,0 L10,5 L0,10 z", class: name }, marker);
  }
}

// ------------------------------------------------------------------ lifelines

/** A lifeline: its heading (▶ when it can expand), a dashed line down. */
function drawLifeline(canvas, lane, index) {
  const { drawing, layout } = canvas;
  const x = laneX(index);
  const headTop = SIZE.LEFT + layout.depth * SIZE.GROUP_H;
  drawLaneHeading(canvas, lane, { x, y: headTop });
  const line = { x1: x, y1: headTop + SIZE.HEAD_H, x2: x, y2: layout.height };
  svg.el("line", { ...line, class: "seq-lifeline" }, drawing);
}

function drawLaneHeading(canvas, lane, place) {
  const facts = laneFacts(canvas.scene, lane);
  const heading = svg.el("g", { class: "seq-lane" }, canvas.drawing);
  drawLaneBox(heading, facts.color, place);
  const nameAt = { x: place.x, y: place.y + 14, class: "seq-lane-name" };
  svg.el("text", nameAt, heading, laneName(lane, facts));
  const defAt = { x: place.x, y: place.y + 28, class: "seq-lane-def" };
  svg.el("text", defAt, heading, facts.defName);
  if (!facts.expandable) return;
  heading.classList.add("expandable");
  svg.tip(heading, "Expand: its parts' lifelines and the actions inside it");
  heading.onclick = () => toggleLane(lane);
}

/** The heading's box: edged in the part's kind colour, lightly tinted. */
function drawLaneBox(heading, color, place) {
  const box = {
    x: place.x - SIZE.STEP_W / 2,
    y: place.y,
    width: SIZE.STEP_W,
    height: SIZE.HEAD_H - 6,
    class: "seq-lane-box",
  };
  const rect = svg.el("rect", box, heading);
  rect.style.stroke = color;
  rect.style.fill = `color-mix(in srgb, ${color} 14%, transparent)`;
}

function laneName(lane, facts) {
  const name = lane.split(".").pop();
  if (facts.expandable) return `▶ ${name}`;
  return name;
}

/** A lifeline's part def, kind colour, and whether it can expand. */
function laneFacts(scene, lane) {
  if (lane === BOUNDARY)
    return {
      defName: "the sheet's ports",
      color: "#8a8f98",
      expandable: false,
    };
  const onLane = scene.steps.filter((placed) => placed.lane === lane);
  const defName = (onLane[0] && onLane[0].step.partDef) || "";
  return {
    defName,
    color: state.KIND_COLORS[model.kindOf(defName)] || "#8a8f98",
    expandable: onLane.some((placed) => placed.step.status === "decomposed"),
  };
}

/** Around each expanded part's lifelines: "▼ ethernet : Ethernet", click to fold. */
function drawBrackets(canvas) {
  for (const group of canvas.scene.groups) drawBracket(canvas, group);
}

function drawBracket(canvas, group) {
  const box = bracketBox(canvas.layout, group);
  const bracket = svg.el("g", { class: "seq-bracket" }, canvas.drawing);
  svg.el("rect", { ...box, class: "seq-bracket-box" }, bracket);
  const defName = canvas.scene.laneDefs.get(group.lane) || "";
  const label = `▼ ${group.lane.split(".").pop()} : ${defName}`;
  const labelAt = { x: box.x + 8, y: box.y + 15, class: "seq-bracket-name" };
  svg.el("text", labelAt, bracket, label);
  svg.tip(bracket, "Fold: back to one lifeline");
  bracket.onclick = () => toggleLane(group.lane);
}

/** A bracket's box: over its lifelines, a little inside its parent's. */
function bracketBox(layout, group) {
  const inset = 4 * group.depth;
  const left = laneX(group.first) - SIZE.LANE_W / 2 + inset;
  const right = laneX(group.last) + SIZE.LANE_W / 2 - inset;
  const top = SIZE.LEFT + (group.depth - 1) * SIZE.GROUP_H;
  return {
    x: left,
    y: top,
    width: right - left,
    height: layout.height - top - 4,
  };
}

// ------------------------------------------------------------------ rows

function drawRows(canvas) {
  let y = canvas.layout.top;
  for (const row of canvas.layout.rows) {
    if (row.placed) drawStep(canvas, row.placed, y);
    else drawMessage(canvas, row.message, y);
    y += rowHeight(row);
  }
}

/** A step: a box on its part's lifeline, in the part's kind colour. */
function drawStep(canvas, placed, y) {
  const x = laneX(canvas.scene.lanes.indexOf(placed.lane));
  const step = placed.step;
  const className = `seq-step ${statusClass(step.status)}`;
  const group = svg.el("g", { class: className }, canvas.drawing);
  const box = {
    x: x - SIZE.STEP_W / 2,
    y,
    width: SIZE.STEP_W,
    height: SIZE.STEP_H,
    fill: kindColor(step.partDef),
    class: "seq-step-box",
  };
  svg.el("rect", box, group);
  const nameAt = { x, y: y + 13, class: "seq-step-name" };
  svg.el("text", nameAt, group, svg.trunc(`${placed.number} ${step.name}`, 24));
  const detailAt = { x, y: y + 26, class: "seq-step-detail" };
  const detail = `${step.actionDef} · ${step.status}`;
  svg.el("text", detailAt, group, svg.trunc(detail, 29));
  svg.tip(group, stepText(step));
}

function kindColor(defName) {
  return state.KIND_COLORS[model.kindOf(defName || "")] || "#8a8f98";
}

function statusClass(status) {
  return `seq-${status.replaceAll(" ", "-")}`;
}

function stepText(step) {
  const performer = step.part ? `${step.part} : ${step.partDef}` : "no part";
  return `${step.name} : ${step.actionDef}\nperformed by ${performer}\n${step.status}`;
}

/** An item: an arrow from the lifeline it leaves to the one it enters. */
function drawMessage(canvas, message, y) {
  const span = messageSpan(canvas.scene, message);
  const wired = wiredState(message);
  const className = `seq-message ${messageClass(wired)}`;
  const group = svg.el("g", { class: className }, canvas.drawing);
  const lineY = y + SIZE.MESSAGE_ROW - 8;
  svg.el("path", { d: arrowPath(span, lineY), class: "seq-arrow" }, group);
  const labelAt = { x: labelX(span), y: lineY - 5, class: "seq-label" };
  svg.el("text", labelAt, group, messageLabel(message, wired));
  svg.tip(group, messageText(message));
}

/** The x of the lifelines an item leaves (start) and enters (end). */
function messageSpan(scene, message) {
  const lanes = scene.lanes;
  return {
    start: laneX(lanes.indexOf(laneOfKey(scene, message.source))),
    end: laneX(lanes.indexOf(laneOfKey(scene, message.target))),
  };
}

/** Over the middle of the arrow; beside the loop of an item within one part. */
function labelX(span) {
  if (span.start === span.end) return span.start + SIZE.SELF_LOOP + 40;
  return (span.start + span.end) / 2;
}

function laneOfKey(scene, key) {
  if (key === BOUNDARY) return BOUNDARY;
  const placed = scene.byKey.get(key);
  if (!placed) return BOUNDARY;
  return placed.lane;
}

/** Across from one lifeline to the other; a small loop if both are the same. */
function arrowPath(span, y) {
  if (span.start !== span.end) return `M${span.start},${y} H${span.end}`;
  const out = span.start + SIZE.SELF_LOOP;
  return `M${span.start},${y - 8} H${out} V${y} H${span.start}`;
}

function messageClass(wired) {
  if (wired === false) return "seq-missing";
  if (wired === null) return "seq-unknown";
  return "seq-wired";
}

function messageLabel(message, wired) {
  const label = model.itemText(message.flow.sourceItem, message.flow.itemType);
  if (wired === false) return `${label}  ⚠`;
  return label;
}

/** Each wire the item travels on, or the one it lacks. */
function messageText(message) {
  const lines = message.flows.map(flowLine);
  const item = model.itemText(message.flow.sourceItem, message.flow.itemType);
  return `${item}\n${lines.join("\n")}`;
}

function flowLine(flow) {
  const route = `${flow.sourceEnd || "?"} → ${flow.targetEnd || "?"}`;
  if (flow.wired === false) return `${route}: no wire`;
  if (flow.wired === null) return `${route}: a port not said`;
  return route;
}

function drawNoSteps(canvas) {
  const noteAt = { x: SIZE.LEFT, y: canvas.layout.top + 20, class: "seq-note" };
  svg.el("text", noteAt, canvas.drawing, noStepsText());
}

function noStepsText() {
  if (model.partsOf(state.editor.sheet).length)
    return "No actions yet: click the sheet port the request comes in by, then each part it reaches.";
  return "No actions: this part performs it itself.";
}
