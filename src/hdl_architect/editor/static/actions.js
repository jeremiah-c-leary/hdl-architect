// HA 2: performed actions. What the open sheet's part def performs, step by
// step, is the core's (core.actions, GET /api/actions?def=...): this module
// fetches it when another sheet opens or model files change, and tells the
// views that show it (the Performs section, the sequence view, the
// footprint) when a new answer arrives.
import * as state from "./state.js";

/** The last answer: the part def it is for, and its report (or {error}). */
let latest = { defName: null, report: null };
/** The part def being fetched, if any. */
let fetching = null;
const listeners = [];

/** Fetch again whenever model files change on disk. */
export function startActions() {
  window.addEventListener(state.MODEL_SAVED_EVENT, refreshActions);
}

/** Call `listener(report)` with every new answer. */
export function onActions(listener) {
  listeners.push(listener);
}

/** The open sheet's report; null while it is being fetched (asked for here). */
export function actionsOfSheet() {
  const sheet = state.editor.sheet;
  if (latest.defName === sheet) return latest.report;
  if (fetching !== sheet) refreshActions();
  return null;
}

/** One performed action of the open sheet, by its name; null if none. */
export function sheetAction(actionName) {
  const report = actionsOfSheet();
  if (!report || report.error) return null;
  return report.actions.find((action) => action.name === actionName) || null;
}

/** Fetch the open sheet's report now; resolves when the views have it. */
export async function refreshActions() {
  const defName = state.editor.sheet;
  if (!defName) return;
  fetching = defName;
  const report = await fetchActions(defName);
  if (fetching !== defName) return; // another sheet opened meanwhile
  fetching = null;
  latest = { defName, report };
  for (const listener of listeners) listener(report);
}

async function fetchActions(defName) {
  const response = await fetch(
    `/api/actions?def=${encodeURIComponent(defName)}`,
  );
  return response.json();
}
