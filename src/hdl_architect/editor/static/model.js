// HA 2: the SysML model: its packages (one per model file) and an index of
// every definition by name, with the questions the editor asks about them,
// and the wires on a sheet. This module owns that data: other modules go
// through these functions, never to the data itself.
import * as state from "./state.js";

/** The model files: {file, model (one SysML package), layout, version, layoutVersion}. */
let sysmlPackages = [];
/** Every SysML definition, by name: {pkg, coll, def}. Rebuilt after every change. */
let sysmlDefinitions = {};

/** The JSON collections that hold definitions, one per kind of definition. */
const DEFINITION_COLLECTIONS = [
  "partDefs",
  "portDefs",
  "attributeDefs",
  "itemDefs",
  "metadataDefs",
  "actionDefs",
];

// ------------------------------------------------------------------ packages

/** Take the model files the server sent, and index their definitions. */
export function load(packages) {
  sysmlPackages = packages;
  indexSysmlDefinitions();
}

/** Every model file, each holding one SysML package. */
export function allSysmlPackages() {
  return sysmlPackages;
}

/** The model file with this file name. */
export function packageInFile(file) {
  return sysmlPackages.find((sysmlPackage) => sysmlPackage.file === file);
}

function packageName(sysmlPackage) {
  return sysmlPackage.model.package.name;
}

// ------------------------------------------------------------------ the definitions index

/**
 * Build the index of every SysML definition in every package (part, port,
 * attribute, item, metadata and action defs), by name, with its package.
 * Rebuilt after every change, so lookups like partDef("Uart") stay current.
 */
export function indexSysmlDefinitions() {
  sysmlDefinitions = {};
  for (const sysmlPackage of sysmlPackages) indexPackage(sysmlPackage);
}

function indexPackage(sysmlPackage) {
  for (const collection of DEFINITION_COLLECTIONS) {
    const definitions = sysmlPackage.model.package[collection] || [];
    for (const definition of definitions)
      sysmlDefinitions[definition.name] = {
        pkg: sysmlPackage,
        coll: collection,
        def: definition,
      };
  }
}

/** Every definition in one package, of every kind. */
function definitionsIn(sysmlPackage) {
  const sysmlModel = sysmlPackage.model.package;
  return DEFINITION_COLLECTIONS.flatMap(
    (collection) => sysmlModel[collection] || [],
  );
}

// ------------------------------------------------------------------ definitions by name

/** "Pkg::Uart" -> "Uart": a definition's name without its package. */
export function unqualifiedName(name) {
  return (name || "").split("::").pop();
}

/** "temp : TempReading", or "temp" while the item has no item def yet. */
export function itemText(name, type) {
  if (!type) return name;
  return `${name} : ${unqualifiedName(type)}`;
}

function entryFor(name) {
  return sysmlDefinitions[unqualifiedName(name)];
}

/** Is there a definition (of any kind) with this name? */
export function isDefined(name) {
  return entryFor(name) !== undefined;
}

/** The definition with this name, of any kind; null if there is none. */
export function definition(name) {
  const entry = entryFor(name);
  if (!entry) return null;
  return entry.def;
}

function definitionInCollection(name, collection) {
  const entry = entryFor(name);
  if (!entry || entry.coll !== collection) return null;
  return entry.def;
}

/** The part def with this name; null if there is none. */
export function partDef(name) {
  return definitionInCollection(name, "partDefs");
}

/** The port def (interface) with this name; null if there is none. */
export function portDef(name) {
  return definitionInCollection(name, "portDefs");
}

/** The package a definition is in; null if there is no such definition. */
export function packageOf(name) {
  const entry = entryFor(name);
  if (!entry) return null;
  return entry.pkg;
}

/** The name of the package a definition is in. */
export function packageNameOf(name) {
  return packageName(packageOf(name));
}

// ------------------------------------------------------------------ lists of definitions

/** Every definition's name, in alphabetical order. */
function definitionNames() {
  return Object.keys(sysmlDefinitions).sort();
}

/** Every part def's name, in alphabetical order. */
export function partDefNames() {
  return definitionNames().filter((name) => partDef(name) !== null);
}

/** Every port def's (interface's) name, in alphabetical order. */
export function portDefNames() {
  return definitionNames().filter((name) => portDef(name) !== null);
}

/** Every action def's name, in alphabetical order. */
export function actionDefNames() {
  return definitionNames().filter((name) => isInCollection(name, "actionDefs"));
}

/** Every item def's name, in alphabetical order. */
export function itemDefNames() {
  return definitionNames().filter((name) => isInCollection(name, "itemDefs"));
}

function isInCollection(name, collection) {
  return definitionInCollection(name, collection) !== null;
}

/** A port usage's identifier, as wires and flows name it: its short name, else its name. */
export function portId(port) {
  return port.shortName || port.name;
}

/** Part defs you can add an instance of: not abstract, and not a kind (Rtl, ...). */
export function instantiablePartDefNames() {
  return partDefNames().filter(isInstantiable);
}

function isInstantiable(name) {
  return !partDef(name).isAbstract && !isKindName(name);
}

// ------------------------------------------------------------------ kinds

/** A kind is a part def that others specialize to say what they are (Rtl, Subsystem, ...). */
function isKindName(name) {
  return name in state.KIND_COLORS;
}

/** The kind of a part def: the first kind it specializes, directly or through other defs. */
export function kindOf(name) {
  return kindThrough(unqualifiedName(name), new Set());
}

function kindThrough(name, visited) {
  if (isKindName(name)) return name;
  if (visited.has(name)) return null; // a specialization cycle: no kind
  visited.add(name);
  for (const general of generalsOf(name)) {
    const kind = kindThrough(unqualifiedName(general), visited);
    if (kind) return kind;
  }
  return null;
}

/** The defs a part def specializes. */
function generalsOf(name) {
  const definition = partDef(name);
  if (!definition) return [];
  return definition.specializes || [];
}

// ------------------------------------------------------------------ sheets

/** A part def drawn as a sheet: it has parts, or is a container kind; never abstract. */
export function isSheet(name) {
  const definition = partDef(name);
  if (!definition || definition.isAbstract) return false;
  return hasParts(definition) || isContainerKind(name);
}

function hasParts(definition) {
  return (definition.parts || []).length > 0;
}

function isContainerKind(name) {
  return state.CONTAINER_KINDS.has(kindOf(name));
}

/** Every part def drawn as a sheet, in alphabetical order. */
export function sheetNames() {
  return partDefNames().filter(isSheet);
}

export function hasNoSheets() {
  return sheetNames().length === 0;
}

/** The FPGA's sheet, if the model has one. */
export function fpgaSheet() {
  return sheetNames().find(isFpga);
}

function isFpga(name) {
  return ["Fpga", "FpgaPart"].includes(kindOf(name));
}

/** The first part def (in the order they were read) with a part of this def: the sheet above it. */
export function sheetContaining(defName) {
  return Object.keys(sysmlDefinitions).find((name) =>
    hasPartOfDef(name, defName),
  );
}

function hasPartOfDef(sheetName, defName) {
  if (!partDef(sheetName)) return false;
  return partsOf(sheetName).some(
    (part) => unqualifiedName(part.type) === defName,
  );
}

// ------------------------------------------------------------------ parts and ports

/** The parts of a part def. */
export function partsOf(defName) {
  return partDef(defName).parts || [];
}

/** The name of a part's def, without its package; null if there is no such part. */
export function partType(defName, partName) {
  const part = findPart(defName, partName);
  if (!part) return null;
  return unqualifiedName(part.type);
}

function findPart(defName, partName) {
  return partsOf(defName).find((part) => part.name === partName);
}

/** The ports of a part def; none if there is no such part def. */
export function portsOfDef(defName) {
  const definition = partDef(defName);
  if (!definition) return [];
  return definition.ports || [];
}

function hasPort(defName, portName) {
  return portsOfDef(defName).some((port) => port.name === portName);
}

/** A port's readable name, else its identifier. */
export function shown(port) {
  return port.label || port.name;
}

/**
 * The other role of an interface: Axi4LiteManager <-> Axi4LiteSubordinate.
 * An interface without a named second role is its own counterpart (the far
 * end uses it conjugated, ~T).
 */
export function counterpart(portDefName) {
  if (!portDefName) return undefined;
  const ownDefinition = portDef(portDefName);
  if (ownDefinition && ownDefinition.conjugateOf)
    return ownDefinition.conjugateOf;
  const mirror = portDefNames().find((name) => isMirrorOf(name, portDefName));
  return mirror || portDefName;
}

function isMirrorOf(name, portDefName) {
  return portDef(name).conjugateOf === unqualifiedName(portDefName);
}

// ------------------------------------------------------------------ imports

/**
 * Every definition a package refers to must be visible in it: add the
 * imports that are missing.
 */
export function repairImports() {
  for (const sysmlPackage of sysmlPackages) repairImportsOf(sysmlPackage);
}

function repairImportsOf(sysmlPackage) {
  for (const referenced of referencesIn(sysmlPackage))
    if (isDefined(referenced)) ensureImport(sysmlPackage, referenced);
}

/** The names a package's definitions refer to: what they specialize, mirror, or are typed by. */
function referencesIn(sysmlPackage) {
  return definitionsIn(sysmlPackage).flatMap(referencesOf).filter(Boolean);
}

/** The JSON collections in a definition that hold usages typed by other definitions. */
const USAGE_COLLECTIONS = [
  "parts",
  "ports",
  "attributes",
  "items",
  "parameters",
  "performs",
  "metadata",
];

function referencesOf(definition) {
  const usages = USAGE_COLLECTIONS.flatMap(
    (collection) => definition[collection] || [],
  );
  const types = usages.map((usage) => usage.type);
  return [...(definition.specializes || []), definition.conjugateOf, ...types];
}

function ensureImport(sysmlPackage, name) {
  if (isVisibleIn(sysmlPackage, name)) return;
  const sysmlModel = sysmlPackage.model.package;
  sysmlModel.imports = sysmlModel.imports || [];
  sysmlModel.imports.push({ name: packageNameOf(name) + "::*" });
}

/** Can a package use this definition without a new import? */
function isVisibleIn(sysmlPackage, name) {
  const owner = packageOf(name);
  if (!owner || owner === sysmlPackage) return true;
  return importedPackageNames(sysmlPackage).includes(packageName(owner));
}

function importedPackageNames(sysmlPackage) {
  const imports = sysmlPackage.model.package.imports || [];
  return imports.map((imported) => imported.name.replace(/::\*$/, ""));
}

// ------------------------------------------------------------------ wires on a sheet

/**
 * A wire end as written in the model ("uart.tx", or "sys_clock" for the
 * sheet's own port) as an end the sheet can draw; null if it cannot be drawn
 * here (a deeper chain, or a part or port that does not exist).
 */
export function parseEnd(sheetName, endText) {
  const segments = endText.split(".");
  if (segments.length === 1) return sheetPortEnd(sheetName, endText);
  if (segments.length === 2) return partPortEnd(sheetName, segments);
  return null;
}

function sheetPortEnd(sheetName, portName) {
  if (!hasPort(sheetName, portName)) return null;
  return { kind: "edge", port: portName };
}

function partPortEnd(sheetName, [partName, portName]) {
  const part = findPart(sheetName, partName);
  if (!part || !hasPort(part.type, portName)) return null;
  return { kind: "part", part: partName, port: portName };
}

/** A drawable end as the model writes it: "uart.tx", or "sys_clock". */
export function endStr(end) {
  if (end.kind === "edge") return end.port;
  return `${end.part}.${end.port}`;
}

/** Wire ends on a sheet that name a part or port that does not exist. */
export function brokenEnds(sheetName) {
  return allWireEnds(sheetName).filter((endText) =>
    isBrokenEnd(sheetName, endText),
  );
}

function allWireEnds(sheetName) {
  const definition = partDef(sheetName);
  const wires = [
    ...(definition.connections || []),
    ...(definition.bindings || []),
  ];
  return wires.flatMap((wire) => wire.ends);
}

function isBrokenEnd(sheetName, endText) {
  const segments = endText.split(".");
  if (segments.length === 1) return !hasPort(sheetName, endText);
  if (segments.length === 2) return isBrokenPartEnd(sheetName, segments);
  return false;
}

function isBrokenPartEnd(sheetName, [partName, portName]) {
  const part = findPart(sheetName, partName);
  if (!part) return true;
  if (!partDef(part.type)) return false; // an unknown def is its own problem, reported by the check
  return !hasPort(part.type, portName);
}

/**
 * The wires a sheet can draw (connections and bindings whose two ends are
 * both drawable), and how many it cannot draw (hidden).
 */
export function wiresOf(sheetName) {
  const definition = partDef(sheetName);
  const connections = definition.connections || [];
  const bindings = definition.bindings || [];
  const wires = [
    ...drawableWires(sheetName, connections, "connect"),
    ...drawableWires(sheetName, bindings, "bind"),
  ];
  const hidden = connections.length + bindings.length - wires.length;
  return { wires, hidden };
}

/** Each wire with both ends drawable, with its kind and its index in the model's list. */
function drawableWires(sheetName, modelWires, kind) {
  const wires = [];
  modelWires.forEach((wire, index) => {
    const endA = parseEnd(sheetName, wire.ends[0]);
    const endB = parseEnd(sheetName, wire.ends[1]);
    if (endA && endB) wires.push({ kind, idx: index, a: endA, b: endB });
  });
  return wires;
}
