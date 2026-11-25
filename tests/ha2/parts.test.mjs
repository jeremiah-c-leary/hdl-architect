// Parts and definitions (core.ops, through the server): on disk at once,
// references follow, the layout keeps up.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { E, TOP, openPage, readModel, startServer } from "./harness.mjs";

const SUBS = "wifi_packet_router_subsystems.json";
const FPGA = "wifi_packet_router_fpga.json";
let server, page;

before(async () => {
  server = await startServer();
  page = await openPage(server.url);
});
after(async () => {
  assert.deepEqual(page.errors, [], "no errors in the page");
  await server.stop();
});

const allDefs = () =>
  [FPGA, SUBS].flatMap((f) => readModel(server.dir, f).package.partDefs);
const defOnDisk = (name) => allDefs().find((d) => d.name === name);
const partsOnDisk = () =>
  Object.fromEntries((defOnDisk(TOP).parts || []).map((p) => [p.name, p.type]));
const topWires = () => {
  const d = defOnDisk(TOP);
  return [...(d.connections || []), ...(d.bindings || [])].map((w) =>
    w.ends.join(" "),
  );
};
const layoutOfPart = (name) =>
  E(page, `JSON.stringify(sheetLayout('${TOP}').parts['${name}'] || null)`);

test("a new component of a kind: its part and def on disk, placed in the column", async () => {
  await E(page, "window.prompt = () => 'dma_ctrl'");
  await E(page, `addComponent('${TOP}', 1, 300, 'Rtl', false)`);
  assert.equal(partsOnDisk().dma_ctrl, "DmaCtrl");
  assert.deepEqual(defOnDisk("DmaCtrl").specializes, ["Rtl"]);
  assert.equal(JSON.parse(await layoutOfPart("dma_ctrl")).col, 1);
});

test("an instance of an existing def", async () => {
  await E(page, "window.prompt = () => 'uart2'");
  await E(page, `addComponent('${TOP}', 2, 300, 'Uart', true)`);
  assert.equal(partsOnDisk().uart2, "Uart");
});

test("renaming a part: its wires follow, and it stays where it was", async () => {
  const before = await layoutOfPart("adc_if");
  await E(page, `renamePart('${TOP}', 'adc_if', 'adc')`);
  assert.ok("adc" in partsOnDisk() && !("adc_if" in partsOnDisk()));
  assert.ok(topWires().includes("adc_jesd adc.adc_jesd"));
  assert.equal(await layoutOfPart("adc"), before);
});

test("renaming a def: every use follows, also the sheet you are on", async () => {
  await E(page, "openSheet('Control')");
  await E(page, "renameDef('Control', 'ControlHub')");
  assert.equal(partsOnDisk().Control, "ControlHub");
  assert.ok(defOnDisk("ControlHub"));
  assert.equal(await E(page, "S.sheet"), "ControlHub");
  assert.ok(await E(page, "!!layoutOf(pkgOf('ControlHub')).sheets.ControlHub"));
  await E(page, "goBack()");
});

test("a def's kind", async () => {
  await E(page, "setKind('Uart', 'Subsystem')");
  assert.deepEqual(defOnDisk("Uart").specializes, ["Subsystem"]);
  assert.equal(await E(page, "kindOf('Uart')"), "Subsystem");
});

test("changing a part's def removes the wires to ports it does not have", async () => {
  await E(page, `setPartDef('${TOP}', 'uart', 'TempSensorInterface')`);
  assert.equal(partsOnDisk().uart, "TempSensorInterface");
  assert.match(
    await E(page, "document.getElementById('hint').textContent"),
    /Removed \d+ wire\(s\) to ports TempSensorInterface does not have/,
  );
});

test("deleting a part removes its wires and its place", async () => {
  await E(page, `deletePart('${TOP}', 'adc')`);
  assert.ok(!("adc" in partsOnDisk()));
  assert.ok(!topWires().some((w) => /(^| )adc\./.test(w)));
  assert.equal(await layoutOfPart("adc"), "null");
});
