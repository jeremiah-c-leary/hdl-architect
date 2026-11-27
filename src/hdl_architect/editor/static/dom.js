// HA 2: small helpers that build the HTML of tables and forms (the actions
// table and its hops).

/** A new element: `<tag class=className>text</tag>`. */
export function element(tag, className, text) {
  const made = document.createElement(tag);
  if (className) made.className = className;
  if (text !== undefined) made.textContent = text;
  return made;
}

/** A small button; a click on it does `act` and goes no further. */
export function button(text, title, act) {
  const made = element("button", "at-button", text);
  made.title = title;
  made.onclick = (event) => {
    event.stopPropagation();
    act();
  };
  return made;
}

export function input(placeholder, value) {
  const made = element("input");
  made.placeholder = placeholder;
  made.value = value;
  return made;
}

/** A <select> of [value, label] options, with `selected` chosen. */
export function picker(options, selected) {
  const select = element("select");
  for (const [value, label] of options) select.append(new Option(label, value));
  select.value = selected;
  return select;
}

/** A <select> of groups {label, names, extra?}, with `selected` chosen. */
export function groupedPicker(groups, selected) {
  const select = element("select");
  if (!selected) select.append(new Option("choose…", ""));
  for (const group of groups) select.append(optionGroup(group));
  select.value = selected;
  return select;
}

function optionGroup(group) {
  const holder = element("optgroup");
  holder.label = group.label;
  for (const name of group.names) holder.append(new Option(name, name));
  for (const [value, label] of group.extra || [])
    holder.append(new Option(label, value));
  return holder;
}

/** Mark a cell ⚠, with why as its tooltip. */
export function markMissing(cell, why) {
  cell.classList.add("at-missing");
  cell.title = why;
  if (!cell.textContent.includes("⚠")) cell.append(" ⚠");
}
