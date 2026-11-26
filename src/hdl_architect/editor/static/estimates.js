// HA 2: resource estimates. The Resources panel shows each part on the open
// sheet, the sheet's total and the FPGA's fit against its target device; a
// leaf block's estimate is entered from its right-click menu. The roll-up is
// the core's (GET /api/resources): this module only shows it, and changes an
// estimate through the set_estimate operation.
import * as model from "./model.js";
import * as state from "./state.js";
import * as store from "./store.js";
import * as svg from "./svg.js";

/** The server's last roll-up: {device, family, resourceNames, capacity, top,
 * definitions: {name: {used, status}}, problems}, or {error}; null at first. */
let latestReport = null;

const ROLL_UP_STATUSES = ["sum of parts", "to break down"];

// ------------------------------------------------------------------ keeping up

/** Fetch the roll-up now, and again whenever model files change on disk. */
export function startResources() {
  window.addEventListener(state.MODEL_SAVED_EVENT, refreshResources);
  return refreshResources();
}

export async function refreshResources() {
  latestReport = await fetchReport();
  showResources();
}

async function fetchReport() {
  const top = model.fpgaSheet();
  if (!top) return { error: "No FPGA sheet: nothing to roll up." };
  const response = await fetch(`/api/resources?top=${encodeURIComponent(top)}`);
  return response.json();
}

// ------------------------------------------------------------------ the panel

/** Draw the Resources panel for the open sheet, from the last roll-up. */
export function showResources() {
  const panel = svg.$("resources");
  if (!panel) return;
  panel.innerHTML = "";
  for (const line of panelLines()) panel.appendChild(line);
}

function panelLines() {
  if (!latestReport) return [panelLine("Waiting for the server…")];
  if (latestReport.error) return [panelLine(latestReport.error, "res-error")];
  return [
    panelLine(`${latestReport.device} (${latestReport.family})`, "res-target"),
    ...partLines(),
    ...sheetTotalLines(),
    ...problemLines(),
  ];
}

/** One line per part on the open sheet: its name and what it uses. */
function partLines() {
  const sheet = state.editor.sheet;
  if (!sheet || !model.partDef(sheet)) return [];
  return model.partsOf(sheet).map((part) => {
    const defName = model.unqualifiedName(part.type);
    return labelledLine(`${part.name} : ${defName}`, describeUse(defName));
  });
}

/** The open sheet's total; on the FPGA's own sheet, also how full it is. */
function sheetTotalLines() {
  const sheet = state.editor.sheet;
  const totals = latestReport.definitions[sheet];
  if (!totals) return [panelLine(`${sheet} is not in ${latestReport.top}.`)];
  const lines = [
    labelledLine("Sheet total", countsText(totals.used), "res-total"),
  ];
  if (sheet === latestReport.top) lines.push(fitLine(totals.used));
  return lines;
}

function fitLine(used) {
  const capacity = latestReport.capacity;
  const percents = latestReport.resourceNames.map(
    (name) => `${name} ${percentOf(used[name], capacity[name])}`,
  );
  return labelledLine(`Fit in ${latestReport.device}`, percents.join(" · "));
}

function percentOf(used, capacity) {
  if (capacity === 0 && used === 0) return "-";
  if (capacity === 0) return "no room";
  return `${Math.round((100 * used) / capacity)}%`;
}

function problemLines() {
  return latestReport.problems.map((problem) =>
    panelLine(problem, "res-error"),
  );
}

/** What a part def uses, as the panel says it. */
function describeUse(defName) {
  const totals = latestReport.definitions[defName];
  if (!totals) return "not under the FPGA";
  if (totals.status === "not estimated") return "not estimated";
  if (totals.status === "to break down") return "to break down";
  return countsText(totals.used);
}

/** "lut 250 · ff 200": the non-zero counts, or "none". */
function countsText(used) {
  const counts = latestReport.resourceNames
    .filter((name) => used[name])
    .map((name) => `${name} ${used[name]}`);
  return counts.join(" · ") || "none";
}

function labelledLine(label, text, className) {
  const line = panelLine(text, className);
  const name = document.createElement("b");
  name.textContent = label;
  line.prepend(name, document.createElement("br"));
  return line;
}

function panelLine(text, className) {
  const line = document.createElement("div");
  line.className = "res-line " + (className || "");
  line.append(document.createTextNode(text));
  return line;
}

// ------------------------------------------------------------------ the menu item

/** The component menu's estimate item: enter one, or why it cannot have one. */
export function estimateItems(component) {
  if (!latestReport || latestReport.error) {
    return [{ head: "Estimate: no target device" }];
  }
  if (isRollUp(component.def)) {
    return [{ head: "Resources: the sum of its parts" }];
  }
  const defName = component.def;
  return [{ label: estimateLabel(defName), act: () => editEstimate(defName) }];
}

/** "Estimate ✓…" when the def has one, else "Estimate…". */
function estimateLabel(defName) {
  if (currentCounts(defName)) return "Estimate ✓…";
  return "Estimate…";
}

function isRollUp(defName) {
  const totals = latestReport.definitions[defName];
  return Boolean(totals) && ROLL_UP_STATUSES.includes(totals.status);
}

/** The part def's estimate in the target's family: {resource: count}, or null. */
function currentCounts(defName) {
  const attributes = model.partDef(defName).attributes || [];
  const estimate = attributes.find(
    (attribute) =>
      model.unqualifiedName(attribute.type) === latestReport.family,
  );
  if (!estimate) return null;
  return estimate.redefines || {};
}

/** Ask for the counts and set them (all zero removes the estimate). */
export async function editEstimate(defName) {
  const counts = await askCounts(defName, currentCounts(defName) || {});
  if (!counts) return null;
  return store.applyOp("set_estimate", {
    def: defName,
    family: latestReport.family,
    values: counts,
  });
}

// ------------------------------------------------------------------ the dialog

/** A dialog with one number per resource; the counts, or null if cancelled. */
function askCounts(defName, current) {
  const dialog = estimateDialog(defName, current);
  document.body.appendChild(dialog);
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.onclose = () => {
      dialog.remove();
      resolve(answerOf(dialog));
    };
  });
}

function estimateDialog(defName, current) {
  const dialog = document.createElement("dialog");
  dialog.id = "estimateDlg";
  const form = document.createElement("form");
  form.method = "dialog";
  form.append(
    dialogTitle(`Estimate of ${defName} (${latestReport.family})`),
    ...latestReport.resourceNames.map((name) =>
      countField(name, current[name]),
    ),
    dialogButtons(),
  );
  dialog.appendChild(form);
  return dialog;
}

function dialogTitle(text) {
  const title = document.createElement("b");
  title.textContent = text;
  return title;
}

function countField(name, value) {
  const label = document.createElement("label");
  label.className = "est-field";
  const input = document.createElement("input");
  Object.assign(input, { type: "number", min: "0", step: "1", name });
  input.value = String(value || 0);
  label.append(document.createTextNode(name), input);
  return label;
}

function dialogButtons() {
  const buttons = document.createElement("div");
  buttons.className = "dlg-buttons";
  buttons.append(dialogButton("cancel", "Cancel"), dialogButton("ok", "Save"));
  return buttons;
}

function dialogButton(value, text) {
  const button = document.createElement("button");
  Object.assign(button, { value, type: "submit", textContent: text });
  return button;
}

function answerOf(dialog) {
  if (dialog.returnValue !== "ok") return null;
  return readCounts(dialog);
}

function readCounts(dialog) {
  const counts = {};
  for (const input of dialog.querySelectorAll("input"))
    counts[input.name] = Math.max(0, Math.round(Number(input.value) || 0));
  return counts;
}
