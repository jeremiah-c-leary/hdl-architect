// HA 2: the resource utilization view: the FPGA's hierarchy as a table, like
// Vivado's hierarchical utilization report, so the architect can find what
// uses a resource. Each row is tinted with its block's kind colour (as its box
// on the sheet); ▼/▶ fold a level; clicking a row opens its sheet; the
// numbers are counts or percent of the device.
import * as interaction from "./interaction.js";
import * as model from "./model.js";
import * as state from "./state.js";
import * as svg from "./svg.js";

let shownReport = null;
const foldedPaths = new Set();
let showPercent = false;

// ------------------------------------------------------------------ open and close

export function openView(report) {
  shownReport = report;
  svg.$("resourceView").hidden = false;
  drawView();
}

/** A new roll-up: redraw if the view is open. */
export function updateView(report) {
  shownReport = report;
  if (isOpen()) drawView();
}

export function closeView() {
  svg.$("resourceView").hidden = true;
}

function isOpen() {
  return !svg.$("resourceView").hidden;
}

export function togglePercent() {
  showPercent = !showPercent;
  drawView();
}

svg.$("rvClose").onclick = closeView;
svg.$("rvToggle").onclick = togglePercent;
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && isOpen()) closeView();
});

// ------------------------------------------------------------------ the table

function drawView() {
  if (shownReport.error) return;
  svg.$("rvTitle").textContent =
    `Resource utilization: ${shownReport.top} on ${shownReport.device}`;
  svg.$("rvToggle").textContent = toggleLabel();
  const table = svg.$("rvTable");
  table.innerHTML = "";
  table.append(headerRow(), ...rowsOf(shownReport.tree, null), ...footerRows());
}

function toggleLabel() {
  if (showPercent) return "Show counts";
  return "Show percent";
}

function headerRow() {
  const names = shownReport.resourceNames;
  return tableRow(["Block", ...names], "rv-head");
}

/** A block's row and, unless it is folded, its parts' rows. */
function rowsOf(block, parent) {
  const rows = [blockRow(block, parent)];
  if (foldedPaths.has(block.path)) return rows;
  for (const child of block.children) rows.push(...rowsOf(child, block));
  return rows;
}

function blockRow(block, parent) {
  const row = tableRow([], "rv-row");
  row.dataset.path = block.path;
  tintRow(row, kindColor(block.definition));
  row.append(nameCell(block), ...useCells(block));
  row.onclick = () => openSheetOf(block, parent);
  return row;
}

/** The block's name, indented by its depth, with ▼/▶ when it has parts. */
function nameCell(block) {
  const cell = document.createElement("td");
  cell.className = "rv-name";
  cell.style.paddingLeft = `${8 + 16 * depthOf(block)}px`;
  if (block.children.length) cell.append(foldToggle(block));
  cell.append(blockLabel(block));
  return cell;
}

function blockLabel(block) {
  if (block.path === shownReport.top) return block.definition;
  return `${block.name} : ${block.definition}`;
}

function depthOf(block) {
  return block.path.split(".").length - 1;
}

function foldToggle(block) {
  const toggle = document.createElement("span");
  toggle.className = "rv-fold";
  toggle.textContent = foldedPaths.has(block.path) ? "▶ " : "▼ ";
  toggle.onclick = (event) => {
    event.stopPropagation();
    toggleFold(block.path);
  };
  return toggle;
}

function toggleFold(path) {
  if (foldedPaths.has(path)) foldedPaths.delete(path);
  else foldedPaths.add(path);
  drawView();
}

/** One cell per resource; one wide cell for a block without numbers. */
function useCells(block) {
  if (block.status === "not estimated" || block.status === "to break down") {
    const cell = tableCell(block.status, "rv-status");
    cell.colSpan = shownReport.resourceNames.length;
    return [cell];
  }
  return shownReport.resourceNames.map((name) =>
    tableCell(useText(block.used[name], name), "rv-number"),
  );
}

function useText(used, name) {
  if (!showPercent) return String(used);
  return percentText(used, shownReport.capacity[name]);
}

function percentText(used, capacity) {
  if (capacity === 0 && used === 0) return "-";
  if (capacity === 0) return "no room";
  return `${Math.round((100 * used) / capacity)}%`;
}

function footerRows() {
  const report = shownReport;
  const used = report.tree.used;
  return [
    footerRow("Capacity", (name) => String(report.capacity[name])),
    footerRow("Margin", (name) => `${report.margins[name]}%`),
    footerRow("Budget", (name) => String(report.budget[name])),
    footerRow("Used", (name) => percentText(used[name], report.capacity[name])),
  ];
}

/** A footer row: its label, then valueOf(resource name) per column. */
function footerRow(label, valueOf) {
  const values = shownReport.resourceNames.map(valueOf);
  return tableRow([label, ...values], "rv-foot");
}

function tableRow(texts, className) {
  const row = document.createElement("tr");
  row.className = className;
  row.append(...texts.map((text) => tableCell(text)));
  return row;
}

function tableCell(text, className) {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (className) cell.className = className;
  return cell;
}

// ------------------------------------------------------------------ colours and sheets

/** A block's kind colour, as its box on the sheet. */
function kindColor(defName) {
  return state.KIND_COLORS[model.kindOf(defName)] || "transparent";
}

/** A row in its block's colour: a stripe on the left, a light tint behind. */
function tintRow(row, color) {
  row.style.borderLeft = `4px solid ${color}`;
  row.style.background = `color-mix(in srgb, ${color} 14%, transparent)`;
}

/** A block with parts opens its own sheet; a leaf, the sheet it is on. */
function openSheetOf(block, parent) {
  closeView();
  if (model.isSheet(block.definition)) interaction.openSheet(block.definition);
  else if (parent) interaction.openSheet(parent.definition);
}
