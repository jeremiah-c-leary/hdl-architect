// HA 2: the resource banner under the toolbar: the target device, and one bar
// per resource that fills as estimates are added (resourcebar.js). Resources
// the device does not have, and the design does not use, are left out.
// "Devices…" compares the design with every device of the family;
// "Hierarchy…" shows what uses each resource.
import * as deviceView from "./deviceview.js";
import * as resourceBar from "./resourcebar.js";
import * as resourceView from "./resourceview.js";
import * as svg from "./svg.js";

/** Draw the banner from a roll-up (core.resources.report_as_dict), or {error}. */
export function showBanner(report) {
  const banner = svg.$("resourceBanner");
  banner.innerHTML = "";
  banner.append(...bannerContents(report));
}

function bannerContents(report) {
  if (report.error) return [element("span", report.error, "rb-error")];
  return [
    devicesButton(),
    element("b", report.device, "rb-device"),
    ...shownResources(report).map((use) => namedBar(use)),
    ...incompleteNote(report),
    hierarchyButton(report),
  ];
}

/** What the design uses of each resource the banner shows. */
function shownResources(report) {
  const uses = report.resourceNames.map((name) => resourceUse(report, name));
  return uses.filter(resourceBar.isWorthShowing);
}

function resourceUse(report, name) {
  return {
    name,
    used: report.tree.used[name],
    capacity: report.capacity[name],
    margin: report.margins[name],
    budget: report.budget[name],
    level: report.levels[name],
  };
}

/** A resource's name, then its bar. */
function namedBar(use) {
  const item = element("span", "", "rb-resource");
  item.dataset.resource = use.name;
  item.append(
    element("span", use.name, "rb-name"),
    resourceBar.resourceBar(use),
  );
  return item;
}

/** "⚠ 5 to break down · 1 not estimated": the bars are not the whole design. */
function incompleteNote(report) {
  const parts = [];
  if (report.toBreakDown.length)
    parts.push(`${report.toBreakDown.length} to break down`);
  if (report.notEstimated.length)
    parts.push(`${report.notEstimated.length} not estimated`);
  if (!parts.length) return [];
  const note = element("button", `⚠ ${parts.join(" · ")}`, "rb-incomplete");
  note.title = "The bars leave these blocks out. Click for the hierarchy.";
  note.onclick = () => resourceView.openView(report);
  return [note];
}

function devicesButton() {
  const button = element("button", "Devices…", "rb-devices");
  button.title = "The design on every device of this family; choose another";
  button.onclick = () => deviceView.openDeviceView();
  return button;
}

function hierarchyButton(report) {
  const button = element("button", "Hierarchy…", "rb-hierarchy");
  button.title = "Resource utilization by block";
  button.onclick = () => resourceView.openView(report);
  return button;
}

function element(tag, text, className) {
  const made = document.createElement(tag);
  made.className = className;
  made.textContent = text;
  return made;
}
