// HA 2: one resource bar: how much of a device's resource a design uses. The
// fill is green within the budget, amber in the margin, red past the device
// (the level comes from the core); a line marks where the margin starts. A
// resource the device does not have is a grey bar.
// The resource banner and the device view both draw it.

/**
 * A bar and its percentage for one resource. `use`: {name, used, capacity,
 * margin, budget, level}, level being "ok", "margin" or "over".
 */
export function resourceBar(use) {
  const bar = element("span", "", "rb-bar");
  bar.title = useText(use);
  bar.append(trackOf(use), percentText(use));
  return bar;
}

function trackOf(use) {
  const track = element("span", "", "rb-track");
  if (use.capacity === 0) {
    track.classList.add("rb-unavailable");
    return track;
  }
  const fill = element("span", "", `rb-fill rb-level-${use.level}`);
  fill.style.width = `${Math.min(100, percentOf(use))}%`;
  const marginLine = element("span", "", "rb-margin-line");
  marginLine.style.left = `${100 - use.margin}%`;
  track.append(fill, marginLine);
  return track;
}

function percentOf(use) {
  return Math.round((100 * use.used) / use.capacity);
}

function percentText(use) {
  if (use.capacity === 0 && use.used === 0) {
    return element("span", "none", "rb-percent");
  }
  if (use.capacity === 0) {
    return element("span", "no room", "rb-percent rb-no-room");
  }
  return element("span", `${percentOf(use)}%`, "rb-percent");
}

/** The tooltip: "85960 of 274080 lut (31%); margin 30%: budget 191856". */
function useText(use) {
  const budget = `margin ${use.margin}%: budget ${use.budget}`;
  return `${use.used} of ${use.capacity} ${use.name}${shareText(use)}; ${budget}`;
}

function shareText(use) {
  if (use.capacity === 0) return "";
  return ` (${percentOf(use)}%)`;
}

function element(tag, text, className) {
  const made = document.createElement(tag);
  made.className = className;
  made.textContent = text;
  return made;
}
