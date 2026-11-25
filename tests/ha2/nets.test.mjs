// Clocks, resets and SYSREF nets, deleting wires and adding sheet ports
// (core.ops, through the server): on disk at once.
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

const defOnDisk = (file, name) =>
  readModel(server.dir, file).package.partDefs.find((d) => d.name === name);
const portOnDisk = (file, def, ident) =>
  (defOnDisk(file, def).ports || []).find(
    (p) => (p.shortName || p.name) === ident,
  );
const topWires = () => {
  const d = defOnDisk(FPGA, TOP);
  return [...(d.connections || []), ...(d.bindings || [])].map((w) =>
    w.ends.join(" "),
  );
};
const net = (name) => `netsOf('${TOP}').nets.find((n) => n.name === '${name}')`;
const hint = () => E(page, "document.getElementById('hint').textContent");

test("pairing a reset with a clock makes it synchronous", async () => {
  await E(page, "setPairing('AdcInterface', 'rst', 'clk')");
  const r = portOnDisk(SUBS, "AdcInterface", "rst").redefines;
  assert.equal(r.clock_port, "clk");
  assert.equal(r.synchronous, true);
});

test("a sink moves to another net", async () => {
  await E(
    page,
    `assignNet('${TOP}', { kind: 'part', part: 'uart', port: 'rst' }, ${net("sys_reset_f")})`,
  );
  assert.ok(topWires().includes("sys_reset_f uart.rst"));
  assert.ok(!topWires().includes("CLK_RST_CTRL.rst_out uart.rst"));
});

test("a plain port joins a clock net as a clock input", async () => {
  await E(page, "newPort('Uart', 'x', 'left')");
  await E(page, "setPortType('Uart', 'x', 'BitIn')");
  await E(
    page,
    `retypeAndAssign('${TOP}', { kind: 'part', part: 'uart', port: 'x' }, ${net("sys_clock")})`,
  );
  assert.equal(portOnDisk(SUBS, "Uart", "x").type, "ClockIn");
  assert.ok(topWires().includes("sys_clock uart.x"));
});

test("a net's frequency", async () => {
  await E(page, "window.prompt = () => '125'");
  await E(page, `setNetFrequency('${TOP}', ${net("sys_clock")})`);
  assert.equal(
    portOnDisk(FPGA, TOP, "sys_clock").redefines.frequency_hz,
    125e6,
  );
});

test("a new reset input, with the note that it is asynchronous", async () => {
  await E(page, "window.prompt = () => 'rst_b'");
  await E(page, "addGlobalPort('Uart', 'reset', 'in', 'rst')");
  assert.equal(portOnDisk(SUBS, "Uart", "rst_b").type, "ResetIn");
  assert.match(await hint(), /asynchronous/);
});

test("deleting a wire", async () => {
  await E(
    page,
    `deleteWire('${TOP}', wiresOf('${TOP}').wires.find((w) => endStr(w.a) === 'adc_if.Control'))`,
  );
  assert.ok(!topWires().includes("adc_if.Control Control.adc_if"));
});

test("a new sheet port on an edge", async () => {
  await E(page, `newSheetPort('${TOP}', 'debug_out', 'right', 940)`);
  assert.ok(portOnDisk(FPGA, TOP, "debug_out"));
  assert.equal(
    await E(page, `sheetLayout('${TOP}').edge.debug_out.side`),
    "right",
  );
});
