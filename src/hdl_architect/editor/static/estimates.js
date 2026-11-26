// HA 2: resource estimates. The roll-up is the core's (GET /api/resources):
// this module fetches it whenever model files change and hands it to the
// resource banner and the utilization view; a leaf block's estimate is
// entered from its right-click menu (the set_estimate operation).
import * as model from "./model.js";
import * as resourceBanner from "./resourcebanner.js";
import * as resourceView from "./resourceview.js";
import * as state from "./state.js";
import * as store from "./store.js";

/** The server's last roll-up (core.resources.report_as_dict), or {error};
 * null until the first answer. */
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
  resourceBanner.showBanner(latestReport);
  resourceView.updateView(latestReport);
}

async function fetchReport() {
  const top = model.fpgaSheet();
  if (!top) return { error: "No FPGA sheet: nothing to roll up." };
  const response = await fetch(`/api/resources?top=${encodeURIComponent(top)}`);
  return response.json();
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
