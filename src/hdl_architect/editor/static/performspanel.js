// HA 2: the side panel's Performs section: the actions the open sheet's part
// def performs, each with how far its steps are described and how many of
// its items have no wire to travel on. Click one for its sequence view;
// right-click to show its footprint on the sheet.
import * as actions from "./actions.js";
import * as footprint from "./footprint.js";
import * as menus from "./menus.js";
import * as model from "./model.js";
import * as sequenceView from "./sequenceview.js";
import * as state from "./state.js";
import * as svg from "./svg.js";

actions.onActions(renderPerforms);

/** Redraw the section from the latest report (fetched if it is not here yet). */
export function renderPerforms() {
  const list = svg.$("performs");
  list.innerHTML = "";
  const report = actions.actionsOfSheet();
  if (!report) return;
  if (report.error) {
    list.append(note(report.error));
    return;
  }
  for (const action of report.actions) list.append(performItem(action));
  if (!report.actions.length) list.append(note("Performs no actions yet."));
}

function performItem(action) {
  const item = document.createElement("div");
  item.className = "item perform";
  if (footprint.isShowing(action.name)) item.classList.add("cur");
  item.append(performHeading(action), summaryLine(action));
  item.title = "Click: its sequence. Right-click: its footprint on the sheet.";
  item.onclick = () => sequenceView.openSequence(action.name);
  item.oncontextmenu = (event) => performMenu(event, action);
  return item;
}

/** "readTemperature : ReadTemperature" and "5 steps" on the right. */
function performHeading(action) {
  const heading = document.createElement("div");
  heading.className = "perform-head";
  heading.textContent = `${action.name} : ${action.actionDef}`;
  const count = document.createElement("span");
  count.className = "perform-count";
  count.textContent = stepCountText(action.steps.length);
  heading.append(count);
  return heading;
}

function stepCountText(count) {
  if (count === 1) return "1 step";
  return `${count} steps`;
}

/** "1 performed · 4 to break down · ⚠ 4 missing wires". */
function summaryLine(action) {
  const line = document.createElement("div");
  line.className = "perform-summary";
  line.textContent = summaryText(action);
  if (missingWires(action)) line.classList.add("has-missing");
  return line;
}

function summaryText(action) {
  if (!action.steps.length) return noStepsText();
  const parts = Object.entries(statusCounts(action.steps)).map(
    ([status, count]) => `${count} ${status}`,
  );
  const missing = missingWires(action);
  if (missing) parts.push(`⚠ ${missing} missing ${wireWord(missing)}`);
  return parts.join(" · ");
}

/** No steps: a block with parts must break it down; a leaf just does it. */
function noStepsText() {
  if (model.partsOf(state.editor.sheet).length) return "to break down";
  return "performed here";
}

/** How many steps have each status, in the order they first appear. */
function statusCounts(steps) {
  const counts = {};
  for (const step of steps)
    counts[step.status] = (counts[step.status] || 0) + 1;
  return counts;
}

function missingWires(action) {
  return action.flows.filter((flow) => flow.wired === false).length;
}

function wireWord(count) {
  if (count === 1) return "wire";
  return "wires";
}

function performMenu(event, action) {
  event.preventDefault();
  menus.menu(event.clientX, event.clientY, [
    { head: `${action.name} : ${action.actionDef}` },
    {
      label: "Sequence view",
      act: () => sequenceView.openSequence(action.name),
    },
    footprintItem(action),
  ]);
}

function footprintItem(action) {
  if (footprint.isShowing(action.name))
    return { label: "Hide footprint", act: footprint.hideFootprint };
  return {
    label: "Show footprint",
    act: () => footprint.showFootprint(action.name),
  };
}

function note(text) {
  const line = document.createElement("div");
  line.className = "hint-s";
  line.textContent = text;
  return line;
}
