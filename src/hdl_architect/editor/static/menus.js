// HA 2: the context menu: one at a time, shown where the user clicked.
// Each menu's entries are made where it is used (partmenu.js, portmenu.js,
// sheetmenus.js, the actions table, ...). An entry is one of:
// - {label, act, danger?}: a choice; a click hides the menu and does `act`;
// - {head}: a heading;
// - {sep: true}: a line between groups;
// - null: nothing (a choice that does not apply here).
import * as svg from "./svg.js";

/** Room kept between the menu and the window's edges, in pixels. */
const MARGIN = 8;

/** Show `entries` at (left, top), kept inside the window. */
export function menu(left, top, entries) {
  const box = svg.$("menu");
  box.innerHTML = "";
  for (const entry of entries) {
    if (entry) box.appendChild(entryRow(entry));
  }
  box.hidden = false;
  placeInWindow(box, { left, top });
}

export function hideMenu() {
  svg.$("menu").hidden = true;
}

function entryRow(entry) {
  const row = document.createElement("div");
  if (entry.sep) row.className = "sep";
  else if (entry.head) headingRow(row, entry.head);
  else choiceRow(row, entry);
  return row;
}

function headingRow(row, text) {
  row.className = "hd";
  row.textContent = text;
}

// The click stops here: `act` may open the next menu (Kind…, Set
// interface…), and the page hides menus on a click that reaches it.
function choiceRow(row, entry) {
  row.className = entry.danger ? "mi danger" : "mi";
  row.textContent = entry.label;
  row.onclick = (event) => {
    event.stopPropagation();
    hideMenu();
    entry.act();
  };
}

/** At the place asked for, moved in if it would stick out of the window. */
function placeInWindow(box, place) {
  const size = box.getBoundingClientRect();
  const left = Math.min(place.left, innerWidth - size.width - MARGIN);
  const top = Math.min(place.top, innerHeight - size.height - MARGIN);
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
  box.style.maxHeight = `${innerHeight - 2 * MARGIN}px`;
  box.style.overflow = "auto";
}
