// HA 2: feedback to the user: the hint line at the bottom of the sheet and
// the status at the top right (saved, not saved, ...).
import { $ } from "./svg.js";

/** Show a message in the hint line under the sheet (empty: the usual help). */
export function showHint(msg) {
  $("hint").textContent = msg || DEFAULT_HINT;
}
export const DEFAULT_HINT =
  "Filled port: has an interface; hollow: none yet. Drag a component's bottom edge to resize. Click a component, Ctrl+click another: two ports and a wire. Click a port, then another port to wire them (or a component / the edge for a new port). Right-click anything for actions. Drag components between columns.";
export function setStatus(t, err) {
  const s = $("status");
  s.textContent = t;
  s.className = err ? "err" : "";
}
/** Show the usual help in the hint line: how to use the sheet. */
export function showDefaultHint() {
  showHint();
}
