// HA 2: a definition's or port's description (SysML `doc`), and a port's
// readable name. Both are model operations (core.ops set_doc and
// set_port_name, through the server).
import * as dialogs from "./dialogs.js";
import * as model from "./model.js";
import * as store from "./store.js";

/**
 * Ask for the description of `target`: {def} (a definition) or {def, port}
 * (a port of it), in a dialog headed `title`, and save it if it changed.
 */
export async function editDoc(title, target, hintText) {
  const described = describedElement(target);
  if (!described) return;
  const text = await dialogs.askText(title, described.doc, hintText);
  if (text === null) return;
  const doc = tidyLines(text);
  if ((described.doc || "") === doc) return;
  const port = target.port || null;
  return store.applyOp("set_doc", { def: target.def, port, text: doc });
}

function describedElement(target) {
  if (target.port) return portOf(target.def, target.port);
  return model.definition(target.def);
}

/** Each line trimmed, and the whole. */
function tidyLines(text) {
  const lines = text.split("\n").map((line) => line.trim());
  return lines.join("\n").trim();
}

/**
 * Ask for a port's readable SysML name ("Processing CSR"); its identifier
 * stays `name` (in the file: name = the readable text, shortName = the
 * identifier).
 */
export async function editLabel(defName, name) {
  const port = portOf(defName, name);
  if (!port) return;
  const label = askLabel(defName, port);
  if (label === null || (port.label || "") === label) return;
  const args = { def: defName, port: name, name: label || null };
  return store.applyOp("set_port_name", args);
}

/** The name typed, without quotes, backslashes or line breaks; null if cancelled. */
function askLabel(defName, port) {
  const answer = prompt(labelQuestion(defName, port.name), port.label || "");
  if (answer === null) return null;
  return answer.replace(/['\\\r\n]/g, "").trim();
}

function labelQuestion(defName, name) {
  return (
    `Name of port ${defName}.${name}: a readable name for the interface, ` +
    `e.g. "Processing CSR". It heads the port in the generated VHDL and the ` +
    `documents; the VHDL name stays ${name}. Empty removes it.`
  );
}

export function portOf(defName, name) {
  return model.portsOfDef(defName).find((port) => port.name === name);
}
