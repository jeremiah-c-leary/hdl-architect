// HA 2: a small toolkit for drawing with SVG and reaching page elements.

/** The page element with this id. */
export const $ = (id) => document.getElementById(id);
export const SVGNS = "http://www.w3.org/2000/svg";
/** A new SVG element with attributes, appended to `parent`, with text. */
export function el(tag, attrs, parent, text) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
/** A tooltip on an SVG element. */
export function tip(e, text) {
  el("title", {}, e, text);
  return e;
}
/** Text shortened to n characters with an ellipsis. */
export function trunc(s, n) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
