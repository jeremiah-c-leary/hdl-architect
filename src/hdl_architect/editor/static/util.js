// HA 2: Small helpers: DOM, names, text.
import { NAME_RE } from "./state.js";

// ------------------------------------------------------------------ utilities
export const $ = (id) => document.getElementById(id);
export const SVGNS = "http://www.w3.org/2000/svg";
export function el(tag, attrs, parent, text) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
export function tip(e, text) {
  el("title", {}, e, text);
  return e;
}
export function pascal(s) {
  return s
    .split(/[_\W]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
}
export function snake(s) {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}
export function shown(port) {
  return port.label || port.name;
} // a port's readable name, else its identifier
export function trunc(s, n) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
export function hint(msg) {
  $("hint").textContent = msg || DEFAULT_HINT;
}
export const DEFAULT_HINT =
  "Filled port: has an interface; hollow: none yet. Drag a component's bottom edge to resize. Click a component, Ctrl+click another: two ports and a wire. Click a port, then another port to wire them (or a component / the edge for a new port). Right-click anything for actions. Drag components between columns.";
export function askName(question, def) {
  for (;;) {
    const v = prompt(question, def || "");
    if (v === null) return null;
    const t = v.trim();
    if (NAME_RE.test(t)) return t;
    alert(
      `"${t}" is not a legal name: a letter, then letters, digits and single underscores (it must also be a legal VHDL name).`,
    );
    def = t
      .replace(/[^A-Za-z0-9_]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
  }
}
