// HA 2: the memory map view, docked under the sheet (decision 14). Like the
// clock tree, it shows the whole design at once, so the crossbars need not be
// hunted for on the sheets. One root's map at a time (the picker), on two
// tabs:
//
// - Map: the memory map as it is read, in address order. Each crossbar's
//   blocks are indented under it, with the gaps between them shown as
//   "(unused)". Click a block to go to it on its sheet.
// - Define: the tree from the root, through each crossbar, to each block.
//   Each line is labelled with its window; click the label to edit it, and
//   right-click a crossbar or the root to set all its windows or the root.
//
// The maps are the core's (GET /api/addresses), fetched whenever the model
// changes on disk; the problems it finds are listed under both tabs.
import * as addressDialogs from "./addressdialogs.js";
import * as addresses from "./addresses.js";
import * as interaction from "./interaction.js";
import * as menus from "./menus.js";
import * as render from "./render.js";
import * as sequenceView from "./sequenceview.js";
import * as state from "./state.js";
import * as svg from "./svg.js";

const MAP_TAB = "map";
const DEFINE_TAB = "define";
let shownTab = MAP_TAB;
/** The name of the map shown; null: the first one. */
let shownMapName = null;

const TREE = {
  LEFT: 16,
  TOP: 16,
  BOX_W: 180,
  BOX_H: 38,
  COLUMN: 420, // from one column of boxes to the next: room for the labels
  ROW: 58,
  ELBOW: 24, // where a line turns, past its parent's box
};

/** Indent of a block's box in the Map tab, per crossbar above it. */
const MAP_INDENT = 22;

// ------------------------------------------------------------------ open and close

export async function openMemoryMap(tab) {
  if (tab) shownTab = tab;
  if (sequenceView.dockedAction() !== null) sequenceView.closeSequence();
  svg.$("memoryMapView").hidden = false;
  await refreshMemoryMap();
}

export function closeMemoryMap() {
  svg.$("memoryMapView").hidden = true;
}

export function isMemoryMapOpen() {
  return !svg.$("memoryMapView").hidden;
}

export function showMapTab(tab) {
  shownTab = tab;
  drawMemoryMap();
}

/** Fetch the maps again and redraw; the model changed, or the view opened. */
export async function refreshMemoryMap() {
  if (!isMemoryMapOpen()) return;
  await addresses.fetchMaps();
  drawMemoryMap();
}

// ------------------------------------------------------------------ drawing

export function drawMemoryMap() {
  const report = addresses.latestMaps();
  showTabButtons();
  clearTabs();
  if (!report || report.error) {
    showMessage(report ? report.error : "Loading…");
    return;
  }
  fillRootPicker(report.maps);
  const memoryMap = shownMap(report.maps);
  if (!memoryMap) showMessage(NO_MAP);
  else if (shownTab === MAP_TAB) drawMapTab(memoryMap, flaggedOf(report));
  else drawDefineTab(memoryMap, flaggedOf(report));
  showNotes(report);
}

const NO_MAP =
  "No memory map yet: right-click the manager port of a memory-mapped bus (a processor's, a PCIe bridge's) and choose Memory map root….";

function showTabButtons() {
  svg.$("mmTabMap").classList.toggle("cur", shownTab === MAP_TAB);
  svg.$("mmTabDefine").classList.toggle("cur", shownTab === DEFINE_TAB);
}

function clearTabs() {
  svg.$("mmMap").replaceChildren();
  svg.$("mmSvg").replaceChildren();
  svg.$("mmMap").hidden = shownTab !== MAP_TAB;
  svg.$("mmSvg").classList.toggle("mm-hidden", shownTab !== DEFINE_TAB);
}

function showMessage(text) {
  svg.$("mmMap").hidden = false;
  svg.$("mmMap").append(element("div", "mm-message", text));
  svg.$("mmRoot").replaceChildren();
  svg.$("mmNotes").replaceChildren();
}

function flaggedOf(report) {
  return new Set(report.flagged || []);
}

// ------------------------------------------------------------------ the root picker

function fillRootPicker(maps) {
  const picker = svg.$("mmRoot");
  picker.replaceChildren();
  for (const memoryMap of maps)
    picker.append(new Option(rootOptionText(memoryMap), memoryMap.name));
  const shown = shownMap(maps);
  if (shown) picker.value = shown.name;
  picker.onchange = () => {
    shownMapName = picker.value;
    drawMemoryMap();
  };
}

function rootOptionText(memoryMap) {
  return `${memoryMap.name}  (from ${memoryMap.root})`;
}

function shownMap(maps) {
  const named = maps.find((memoryMap) => memoryMap.name === shownMapName);
  return named || maps[0] || null;
}

// ------------------------------------------------------------------ the Map tab

function drawMapTab(memoryMap, flagged) {
  const holder = svg.$("mmMap");
  holder.append(mapHeading(memoryMap));
  if (!memoryMap.top) {
    holder.append(
      element("div", "mm-message", "(the root is not wired to anything)"),
    );
    return;
  }
  const lines = [];
  mapLines(memoryMap.top, 0, lines);
  for (const line of lines) holder.append(mapRow(line, flagged));
  holder.append(mapSummary(lines));
}

function mapHeading(memoryMap) {
  const text = `Memory map ${memoryMap.name}: from ${memoryMap.root}, at ${addresses.addressText(memoryMap.base)}`;
  return element("div", "mm-heading", text);
}

/**
 * The rows of the Map tab, in address order: {kind, block, depth} for a
 * block ("crossbar", "registers"; "unset" for a window not set yet), and
 * {kind: "gap", base, size, depth} for unused space in a crossbar's window.
 */
function mapLines(block, depth, lines) {
  lines.push({ kind: block.windowSet ? block.role : "unset", block, depth });
  if (block.role !== "crossbar") return;
  const placed = block.children.filter(isPlaced);
  placed.sort((first, second) => first.base - second.base);
  let next = block.base;
  for (const child of placed) {
    pushGap(lines, { from: next, to: child.base, depth: depth + 1 });
    mapLines(child, depth + 1, lines);
    next = Math.max(next, child.base + child.size);
  }
  pushGap(lines, { from: next, to: windowEnd(block), depth: depth + 1 });
  for (const child of block.children.filter((one) => !isPlaced(one)))
    mapLines(child, depth + 1, lines);
}

/** A block with its window set: it has a place in address order. */
function isPlaced(block) {
  return block.windowSet && Boolean(block.size);
}

/** Where a crossbar's own window ends; null if it has none (straight from a root). */
function windowEnd(block) {
  return isPlaced(block) ? block.base + block.size : null;
}

/** "(unused)" from one address to the next, if there is space between. */
function pushGap(lines, span) {
  if (span.to === null || span.to <= span.from) return;
  const size = span.to - span.from;
  lines.push({ kind: "gap", base: span.from, size, depth: span.depth });
}

function mapRow(line, flagged) {
  const row = element("div", `mm-row mm-${line.kind}`);
  if (line.block && flagged.has(line.block.path))
    row.classList.add("mm-flagged");
  row.append(element("span", "mm-address", rowAddress(line)), rowBox(line));
  if (line.block) row.onclick = () => rowClicked(line);
  return row;
}

function rowAddress(line) {
  if (line.kind === "unset") return "";
  const base = line.kind === "gap" ? line.base : line.block.base;
  return addresses.addressText(base);
}

function rowBox(line) {
  const box = element("div", "mm-box");
  box.style.marginLeft = `${line.depth * MAP_INDENT}px`;
  if (line.kind === "gap") {
    box.append(element("span", "mm-name", "(unused)"));
    box.append(element("span", "mm-size", addresses.sizeText(line.size)));
    return box;
  }
  const block = line.block;
  box.append(
    element("span", "mm-name", shortPath(block.path)),
    element("span", "mm-def", definitionText(block)),
    element("span", "mm-size", sizeOrSpan(line)),
  );
  return box;
}

function definitionText(block) {
  if (block.role === "crossbar") return `${block.definition} · crossbar`;
  return block.definition;
}

function sizeOrSpan(line) {
  const block = line.block;
  if (line.kind === "unset") return "(window not set)";
  if (!block.size) return "(no window: straight from the root)";
  if (block.role === "crossbar") return spanAndSize(block);
  return addresses.sizeText(block.size);
}

function spanAndSize(block) {
  return `${addresses.spanText(block.base, block.size)}  ${addresses.sizeText(block.size)}`;
}

/** A block's row: an unset window opens its crossbar's windows; else go to the block. */
function rowClicked(line) {
  if (line.kind === "unset" && line.block.via) {
    const crossbar = crossbarAbove(line.block);
    if (crossbar)
      addressDialogs.editWindows(
        crossbar.sheet,
        crossbar.part,
        line.block.via.port,
      );
    return;
  }
  goTo(line.block.sheet, line.block.part);
}

function crossbarAbove(block) {
  const report = addresses.latestMaps();
  for (const memoryMap of report.maps) {
    const found = parentOf(memoryMap.top, block);
    if (found) return found;
  }
  return null;
}

function parentOf(parent, block) {
  if (!parent) return null;
  for (const child of parent.children) {
    if (child === block) return parent;
    const found = parentOf(child, block);
    if (found) return found;
  }
  return null;
}

function mapSummary(lines) {
  const leaves = lines.filter((line) => line.kind === "registers");
  const used = leaves.reduce((sum, line) => sum + (line.block.size || 0), 0);
  const text = `${leaves.length} register block${leaves.length === 1 ? "" : "s"} · ${addresses.sizeText(used)} in windows`;
  return element("div", "mm-summary", text);
}

// ------------------------------------------------------------------ the Define tab

function drawDefineTab(memoryMap, flagged) {
  const tree = defineTree(memoryMap);
  const drawing = svg.$("mmSvg");
  const size = treeSize(tree);
  drawing.setAttribute("width", size.width);
  drawing.setAttribute("height", size.height);
  drawLines(drawing, tree, flagged);
  drawBoxes(drawing, tree, flagged);
  svg.el(
    "text",
    { x: TREE.LEFT, y: size.height - 8, class: "mm-tree-hint" },
    drawing,
    "Click a window's label to edit it · right-click a crossbar for all its windows, or the root to change it",
  );
}

/** The tree's nodes, laid out: {kind, block|map, depth, y, children}. */
function defineTree(memoryMap) {
  const root = { kind: "root", map: memoryMap, children: [] };
  if (memoryMap.top) root.children.push(blockNode(memoryMap.top));
  let nextRow = 0;
  const place = (node, depth) => {
    node.depth = depth;
    if (!node.children.length) {
      node.y = TREE.TOP + nextRow++ * TREE.ROW;
      return;
    }
    for (const child of node.children) place(child, depth + 1);
    const first = node.children[0].y;
    const last = node.children[node.children.length - 1].y;
    node.y = (first + last) / 2;
  };
  place(root, 0);
  root.rows = nextRow;
  return root;
}

function blockNode(block) {
  return {
    kind: block.role,
    block,
    children: block.children.map(blockNode),
  };
}

function treeNodes(node, found = []) {
  found.push(node);
  for (const child of node.children) treeNodes(child, found);
  return found;
}

function treeSize(tree) {
  const depth = Math.max(...treeNodes(tree).map((node) => node.depth));
  return {
    width: TREE.LEFT * 2 + depth * TREE.COLUMN + TREE.BOX_W,
    height: TREE.TOP + tree.rows * TREE.ROW + 24,
  };
}

function nodeX(node) {
  return TREE.LEFT + node.depth * TREE.COLUMN;
}

function drawLines(drawing, tree, flagged) {
  for (const parent of treeNodes(tree))
    for (const child of parent.children)
      drawLine(drawing, { parent, child }, flagged);
}

function drawLine(drawing, wire, flagged) {
  const { parent, child } = wire;
  const fromX = nodeX(parent) + TREE.BOX_W;
  const fromY = parent.y + TREE.BOX_H / 2;
  const toX = nodeX(child);
  const toY = child.y + TREE.BOX_H / 2;
  const turnX = fromX + TREE.ELBOW;
  const classes = ["mm-line", lineState(child, flagged)].join(" ");
  svg.el(
    "path",
    { d: `M${fromX},${fromY} H${turnX} V${toY} H${toX}`, class: classes },
    drawing,
  );
  drawLineLabel(drawing, wire, { x: turnX + 8, y: toY - 6 });
}

function lineState(child, flagged) {
  if (child.block && flagged.has(child.block.path)) return "mm-line-flagged";
  if (child.block && !child.block.windowSet) return "mm-line-unset";
  return "";
}

/** The window on a line, as a label: click it to edit that window. */
function drawLineLabel(drawing, wire, where) {
  const { parent, child } = wire;
  if (parent.kind === "root") {
    const text = `at ${addresses.addressText(parent.map.base)}`;
    svg.el("text", { ...where, class: "mm-label" }, drawing, text);
    return;
  }
  const via = child.block.via;
  if (!via) return;
  const label = svg.el(
    "text",
    { ...where, class: "mm-label mm-label-edit" },
    drawing,
    windowLabel(child.block),
  );
  svg.tip(label, windowTip(child.block));
  label.onclick = () =>
    addressDialogs.editWindows(parent.block.sheet, parent.block.part, via.port);
}

function windowLabel(block) {
  const port = block.via.port;
  if (!block.windowSet) return `${port}  (no window: click to set)`;
  return `${port}  ${addresses.addressText(block.base)}  ${addresses.sizeText(block.size)}`;
}

function windowTip(block) {
  const via = block.via;
  if (!block.windowSet) return `${via.ends.join(" to ")}: no window yet`;
  const offset = addresses.addressText(via.offset);
  return `${via.ends.join(" to ")} on ${via.sheet}: offset ${offset} from the crossbar's base, ${addresses.spanText(block.base, block.size)}`;
}

function drawBoxes(drawing, tree, flagged) {
  for (const node of treeNodes(tree)) drawBox(drawing, node, flagged);
}

function drawBox(drawing, node, flagged) {
  const where = `translate(${nodeX(node)},${node.y})`;
  const group = svg.el(
    "g",
    { class: `mm-node mm-node-${node.kind}`, transform: where },
    drawing,
  );
  if (node.block && flagged.has(node.block.path))
    group.classList.add("mm-flagged");
  svg.el("rect", { width: TREE.BOX_W, height: TREE.BOX_H, rx: 4 }, group);
  drawBoxText(group, boxText(node));
  group.onclick = () => goTo(...placeOf(node));
  group.oncontextmenu = (event) => nodeMenu(event, node);
}

function drawBoxText(group, lines) {
  const [first, second] = lines;
  const name = { x: 8, y: 15, class: "mm-node-name" };
  const definition = { x: 8, y: 30, class: "mm-node-def" };
  svg.el("text", name, group, svg.trunc(first, 26));
  svg.el("text", definition, group, svg.trunc(second, 30));
}

function boxText(node) {
  if (node.kind === "root")
    return [shortPath(node.map.root), `root "${node.map.name}"`];
  const role = node.kind === "crossbar" ? " · crossbar" : "";
  return [shortPath(node.block.path), node.block.definition + role];
}

/** [sheet, part] where a node is drawn on the sheets. */
function placeOf(node) {
  if (node.kind === "root") return [node.map.sheet, node.map.part];
  return [node.block.sheet, node.block.part];
}

/** The right-click menu of a box: its root or windows, and going to it. */
function nodeMenu(event, node) {
  event.preventDefault();
  const [sheet, part] = placeOf(node);
  menus.menu(event.clientX, event.clientY, [
    { head: boxText(node)[0] },
    nodeEditEntry(node),
    { label: "Go to it on its sheet", act: () => goTo(sheet, part) },
  ]);
}

/** A root's "Memory map root…", a crossbar's "Memory map windows…"; else null. */
function nodeEditEntry(node) {
  if (node.kind === "root") {
    const { portDef, port } = node.map;
    return {
      label: "Memory map root…",
      act: () => addressDialogs.editRoot(portDef, port),
    };
  }
  if (node.kind !== "crossbar") return null;
  const { sheet, part } = node.block;
  return {
    label: "Memory map windows…",
    act: () => addressDialogs.editWindows(sheet, part),
  };
}

// ------------------------------------------------------------------ the notes

function showNotes(report) {
  const holder = svg.$("mmNotes");
  holder.replaceChildren();
  const notes = [
    ...report.problems.map((text) => ["problem", text]),
    ...report.warnings.map((text) => ["warning", text]),
  ];
  if (!notes.length) {
    holder.append(element("div", "mm-note", "No problems."));
    return;
  }
  for (const [kind, text] of notes)
    holder.append(element("div", `mm-note mm-${kind}`, `${kind}: ${text}`));
}

// ------------------------------------------------------------------ helpers

/** Open the sheet a part is on, with the part selected. */
function goTo(sheet, part) {
  if (!sheet) return;
  interaction.openSheet(sheet);
  if (state.editor.sheet !== sheet) return;
  state.editor.sel = part ? { kind: "part", name: part } : null;
  render.render();
}

/** A path without the top's name: FpgaOne.serial.regs -> serial.regs. */
function shortPath(path) {
  const dot = path.indexOf(".");
  return dot < 0 ? path : path.slice(dot + 1);
}

function element(tag, className, text) {
  const made = document.createElement(tag);
  made.className = className;
  if (text !== undefined) made.textContent = text;
  return made;
}

// ------------------------------------------------------------------ wiring

svg.$("memoryMapBtn").onclick = () => openMemoryMap();
svg.$("mmClose").onclick = closeMemoryMap;
svg.$("mmTabMap").onclick = () => showMapTab(MAP_TAB);
svg.$("mmTabDefine").onclick = () => showMapTab(DEFINE_TAB);
window.addEventListener(state.MODEL_SAVED_EVENT, refreshMemoryMap);
sequenceView.onDockOpen(closeMemoryMap); // one dock under the sheet at a time
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !isMemoryMapOpen()) return;
  if (document.querySelector("dialog[open]")) return; // Esc closes the dialog first
  closeMemoryMap();
});
