// HA 2: the resource banner under the toolbar: the target device, and one bar
// per resource that fills as estimates are added. A bar is green within the
// budget (the device less the margin), amber in the margin, red past the
// device; a line marks where the margin starts. "Hierarchy…" opens the
// utilization view, so the architect can find what uses a resource.
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
  const bars = report.resourceNames.map((name) => resourceBar(report, name));
  return [
    element("b", report.device, "rb-device"),
    ...bars,
    ...incompleteNote(report),
    hierarchyButton(report),
  ];
}

// ------------------------------------------------------------------ one resource

/** A resource's name, its bar with the margin line, and its percentage. */
function resourceBar(report, name) {
  const use = resourceUse(report, name);
  const item = element("span", "", "rb-resource");
  item.title = useText(use);
  item.append(element("span", name, "rb-name"), barOf(use), percentText(use));
  return item;
}

/** What the design uses of a resource, and what it has. */
function resourceUse(report, name) {
  return {
    name,
    used: report.tree.used[name],
    capacity: report.capacity[name],
    margin: report.margins[name],
    budget: report.budget[name],
  };
}

function barOf(use) {
  const track = element("span", "", "rb-track");
  if (use.capacity === 0) return track;
  const fill = element("span", "", `rb-fill rb-level-${levelOf(use)}`);
  fill.style.width = `${Math.min(100, percentOf(use))}%`;
  const marginLine = element("span", "", "rb-margin-line");
  marginLine.style.left = `${100 - use.margin}%`;
  track.append(fill, marginLine);
  return track;
}

/** "ok" within the budget, "margin" in the margin, "over" past the device. */
function levelOf(use) {
  if (use.used > use.capacity) return "over";
  if (use.used > use.budget) return "margin";
  return "ok";
}

function percentOf(use) {
  return Math.round((100 * use.used) / use.capacity);
}

function percentText(use) {
  if (use.capacity === 0 && use.used === 0) {
    return element("span", "none on device", "rb-percent");
  }
  if (use.capacity === 0)
    return element("span", "no room", "rb-percent rb-no-room");
  return element("span", `${percentOf(use)}%`, "rb-percent");
}

/** The tooltip: "85960 of 274080 lut (31%); margin 30%: budget 191856". */
function useText(use) {
  const share = use.capacity ? ` (${percentOf(use)}%)` : "";
  const budget = `margin ${use.margin}%: budget ${use.budget}`;
  return `${use.used} of ${use.capacity} ${use.name}${share}; ${budget}`;
}

// ------------------------------------------------------------------ the rest

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
