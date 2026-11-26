// HA 2: the device view: the design on every device of its target's family,
// smallest first, as the same bars as the banner (resourcebar.js), with the
// FPGA's own margins. The smallest device that fits is marked; "Use" makes a
// device the target (the set_device operation). The comparison is the core's
// (GET /api/devices).
import * as model from "./model.js";
import * as resourceBar from "./resourcebar.js";
import * as state from "./state.js";
import * as store from "./store.js";
import * as svg from "./svg.js";

let shownFits = null;

const VERDICT_CLASSES = {
  fits: "dv-fits",
  "uses margin": "dv-uses-margin",
  "does not fit": "dv-does-not-fit",
};

// ------------------------------------------------------------------ open and close

export async function openDeviceView() {
  svg.$("deviceView").hidden = false;
  await refreshDeviceView();
}

export function closeDeviceView() {
  svg.$("deviceView").hidden = true;
}

function isOpen() {
  return !svg.$("deviceView").hidden;
}

/** Fetch the comparison again and redraw. */
export async function refreshDeviceView() {
  shownFits = await fetchFits();
  drawDeviceView();
}

async function fetchFits() {
  const top = model.fpgaSheet();
  if (!top) return { error: "No FPGA sheet: nothing to compare." };
  const response = await fetch(`/api/devices?top=${encodeURIComponent(top)}`);
  return response.json();
}

svg.$("dvClose").onclick = closeDeviceView;
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && isOpen()) closeDeviceView();
});
window.addEventListener(state.MODEL_SAVED_EVENT, () => {
  if (isOpen()) refreshDeviceView();
});

// ------------------------------------------------------------------ the table

function drawDeviceView() {
  const table = svg.$("dvTable");
  table.innerHTML = "";
  svg.$("dvNote").textContent = noteText();
  if (shownFits.error) return;
  svg.$("dvTitle").textContent =
    `Devices: ${shownFits.top} on ${shownFits.family}, smallest first`;
  table.append(headerRow(), ...shownFits.devices.map(deviceRow));
}

function headerRow() {
  const row = document.createElement("tr");
  row.className = "dv-head";
  const names = shownFits.resourceNames;
  row.append(...["Device", ...names, "Fit", ""].map((text) => cell(text)));
  return row;
}

function deviceRow(fit) {
  const row = document.createElement("tr");
  row.className = rowClasses(fit);
  row.dataset.device = fit.device;
  row.append(
    deviceCell(fit),
    ...shownFits.resourceNames.map((name) => barCell(fit, name)),
    cell(fit.verdict, VERDICT_CLASSES[fit.verdict]),
    useCell(fit),
  );
  return row;
}

function rowClasses(fit) {
  const classes = ["dv-row"];
  if (fit.device === shownFits.target) classes.push("dv-target");
  if (fit.device === shownFits.smallestFit) classes.push("dv-smallest");
  return classes.join(" ");
}

function deviceCell(fit) {
  const nameCell = cell(fit.device, "dv-device");
  if (fit.device === shownFits.smallestFit)
    nameCell.append(tag("smallest that fits"));
  return nameCell;
}

function barCell(fit, name) {
  const barHolder = cell("", "dv-bar");
  barHolder.append(resourceBar.resourceBar(useOn(fit, name)));
  return barHolder;
}

/** What the design uses of one resource on one device. */
function useOn(fit, name) {
  return {
    name,
    used: shownFits.used[name],
    capacity: fit.capacity[name],
    margin: shownFits.margins[name],
    budget: fit.budget[name],
    level: fit.levels[name],
  };
}

/** "Use" makes the device the target; the target itself says so. */
function useCell(fit) {
  const holder = cell("", "dv-use");
  if (fit.device === shownFits.target) {
    holder.textContent = "target";
    return holder;
  }
  const button = document.createElement("button");
  button.textContent = "Use";
  button.title = `Make ${fit.device} the target device`;
  button.onclick = () => useDevice(fit.device);
  holder.append(button);
  return holder;
}

export function useDevice(device) {
  return store.applyOp("set_device", { def: shownFits.top, device });
}

/** The error, or a warning that the design is not complete yet. */
function noteText() {
  if (shownFits.error) return shownFits.error;
  const missing = shownFits.toBreakDown.length + shownFits.notEstimated.length;
  if (!missing) return "";
  return `⚠ ${missing} blocks to break down or estimate: the design will grow.`;
}

function tag(text) {
  const label = document.createElement("span");
  label.className = "dv-tag";
  label.textContent = text;
  return label;
}

function cell(text, className) {
  const made = document.createElement("td");
  made.textContent = text;
  if (className) made.className = className;
  return made;
}
