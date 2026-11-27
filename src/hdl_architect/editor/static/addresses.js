// HA 2: what the address map needs to know of the model (decision 14), and
// how addresses are written. The model's shapes are in core/addresses.py:
//
// - a memory-mapped bus's port def specializes MemoryMappedManager; its
//   manager ports carry addresses (a conjugated port is the subordinate);
// - a root is `attribute root : MemoryMapRoot` on a manager port;
// - a crossbar's part def specializes Crossbar as well as its kind;
// - a window is `attribute window : AddressWindow` on a connection from a
//   crossbar's manager port.
//
// The server works out the memory maps (GET /api/addresses); this module
// fetches them and keeps the last answer for the view and the dialogs.
import * as model from "./model.js";
import * as state from "./state.js";

export const MANAGER = "MemoryMappedManager";
export const CROSSBAR = "Crossbar";
export const ROOT = "MemoryMapRoot";
export const WINDOW = "AddressWindow";

// ------------------------------------------------------------------ the server's maps

/** The server's last answer (core.addresses.report_as_dict), or {error}. */
let latestReport = null;

/** The memory maps of the FPGA (or of the open sheet, with no FPGA). */
export async function fetchMaps() {
  const top = model.fpgaSheet() || state.editor.sheet;
  if (!top) {
    latestReport = { error: "No sheet: there is no memory map to show." };
    return latestReport;
  }
  const response = await fetch(`/api/addresses?top=${encodeURIComponent(top)}`);
  latestReport = await response.json();
  return latestReport;
}

export function latestMaps() {
  return latestReport;
}

/** Where a crossbar part on a sheet is in the last maps (its base and size), or null. */
export function crossbarBlock(sheet, part) {
  if (!latestReport || !latestReport.maps) return null;
  for (const memoryMap of latestReport.maps) {
    const found = findBlock(memoryMap.top, sheet, part);
    if (found) return found;
  }
  return null;
}

function findBlock(block, sheet, part) {
  if (!block) return null;
  if (block.sheet === sheet && block.part === part) return block;
  for (const child of block.children) {
    const found = findBlock(child, sheet, part);
    if (found) return found;
  }
  return null;
}

// ------------------------------------------------------------------ crossbars

/** The model has the part def Crossbar (FpgaLib does), so a def can say it is one. */
export function canMarkCrossbars() {
  return model.partDef(CROSSBAR) !== null;
}

/** A part def that specializes Crossbar, directly or through other defs. */
export function isCrossbar(defName) {
  return partGenerals(defName).has(CROSSBAR);
}

function partGenerals(defName) {
  const found = new Set();
  const pending = [model.unqualifiedName(defName)];
  while (pending.length) {
    const name = pending.pop();
    const definition = model.partDef(name);
    if (found.has(name) || !definition) continue;
    found.add(name);
    for (const general of definition.specializes || [])
      pending.push(model.unqualifiedName(general));
  }
  return found;
}

// ------------------------------------------------------------------ ports

/** A port on the manager side of a memory-mapped bus (as core.addresses.port_role says). */
export function isManagerPort(port) {
  if (!port || !port.type) return false;
  let name = model.unqualifiedName(port.type);
  let conjugated = Boolean(port.conjugated);
  const definition = model.portDef(name);
  if (definition && definition.conjugateOf) {
    name = model.unqualifiedName(definition.conjugateOf);
    conjugated = !conjugated;
  }
  return !conjugated && portGenerals(name).has(MANAGER);
}

function portGenerals(defName) {
  const found = new Set();
  const pending = [defName];
  while (pending.length) {
    const name = pending.pop();
    const definition = model.portDef(name);
    if (found.has(name) || !definition) continue;
    found.add(name);
    for (const general of definition.specializes || [])
      pending.push(model.unqualifiedName(general));
  }
  return found;
}

/** The values of a port's root mark ({map_name, base}), or null if it is not a root. */
export function rootOf(port) {
  const attribute = typedAttribute(port, ROOT);
  return attribute ? attribute.redefines || {} : null;
}

/** The values of a connection's window ({base, size}), or null if it has none. */
export function windowOf(connection) {
  const attribute = typedAttribute(connection, WINDOW);
  return attribute ? attribute.redefines || {} : null;
}

function typedAttribute(element, typeName) {
  const attributes = (element && element.attributes) || [];
  return attributes.find(
    (attribute) => model.unqualifiedName(attribute.type) === typeName,
  );
}

/** The manager ports of a crossbar's part def, but not its roots. */
export function managerPorts(defName) {
  return model
    .portsOfDef(defName)
    .filter((port) => isManagerPort(port) && !rootOf(port));
}

// ------------------------------------------------------------------ writing addresses

/** 0x4000_1000: hex, at least 8 digits, in groups of 4 (as `ha report addresses`). */
export function addressText(address) {
  let digits = address.toString(16).toUpperCase().padStart(8, "0");
  const groups = [];
  while (digits) {
    groups.unshift(digits.slice(-4));
    digits = digits.slice(0, -4);
  }
  return "0x" + groups.join("_");
}

const UNITS = [
  ["GiB", 2 ** 30],
  ["MiB", 2 ** 20],
  ["KiB", 2 ** 10],
];

/** 4 KiB, 1 MiB, ...; bytes if it is not a whole number of KiB. */
export function sizeText(size) {
  for (const [unit, scale] of UNITS)
    if (size >= scale && size % scale === 0) return `${size / scale} ${unit}`;
  return `${size} B`;
}

/** first..last of a span: 0x4000_0000..0x4000_0FFF. */
export function spanText(base, size) {
  return `${addressText(base)}..${addressText(base + size - 1)}`;
}

const SCALES = { K: 2 ** 10, M: 2 ** 20, G: 2 ** 30 };

/**
 * A number as typed: 0x4000_1000, 4096, 4K, 4 KiB, 1M... (underscores and
 * spaces are ignored). null if it is not one.
 */
export function parseNumber(text) {
  const cleaned = String(text).replace(/[_\s]/g, "");
  const hex = cleaned.match(/^0x([0-9a-f]+)$/i);
  if (hex) return parseInt(hex[1], 16);
  const scaled = cleaned.match(/^(\d+)([KMG])(i?B)?$/i);
  if (scaled) return Number(scaled[1]) * SCALES[scaled[2].toUpperCase()];
  const plain = cleaned.match(/^(\d+)B?$/i);
  if (plain) return Number(plain[1]);
  return null;
}
