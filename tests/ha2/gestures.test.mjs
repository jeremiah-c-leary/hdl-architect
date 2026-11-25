// The "new port + wire" gestures (core.ops.connect_new, through the server).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { E, TOP, openPage, readModel, saved, startServer } from "./harness.mjs";

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
const topOnDisk = () => defOnDisk(FPGA, TOP);
const ends = (list) => (list || []).map((w) => w.ends.join(" "));
const side = (P, port) => E(page, `portLayout('${P}', '${port}').side`);

test("Ctrl+click two components: a new port on each, named after the other, wired", async () => {
  await E(page, "quickConnect('uart', 'adc_if')");
  assert.ok(portOnDisk(SUBS, "Uart", "adc_if"));
  assert.ok(portOnDisk(SUBS, "AdcInterface", "uart"));
  assert.ok(ends(topOnDisk().connections).includes("adc_if.uart uart.adc_if")); // left first
  assert.equal(await side("AdcInterface", "uart"), "right"); // facing each other
  assert.equal(await side("Uart", "adc_if"), "left");
});

test("click a port, then a component: a new port there with the matching interface", async () => {
  await E(page, "newPort('AdcInterface', 'cfg', 'right')");
  await E(page, "setPortType('AdcInterface', 'cfg', 'Axi4LiteManager')");
  await E(page, "S.armed = { kind: 'part', part: 'adc_if', port: 'cfg' }");
  await E(page, "connectArmed({ part: 'ethernet' })");
  const p = portOnDisk(SUBS, "Ethernet", "adc_if");
  assert.equal(p.type, "Axi4LiteSubordinate");
  assert.ok(
    ends(topOnDisk().connections).includes("adc_if.cfg ethernet.adc_if"),
  );
  assert.equal(await side("Ethernet", "adc_if"), "left");
});

test("click a component's port, then the sheet edge: a new sheet port, bound", async () => {
  await E(page, "newPort('Uart', 'tx_dbg', 'right')");
  await E(page, "setPortType('Uart', 'tx_dbg', 'BitIn')");
  await E(page, "S.armed = { kind: 'part', part: 'uart', port: 'tx_dbg' }");
  await E(page, "connectArmed({ edge: 'right', y: 950 })");
  const p = portOnDisk(FPGA, TOP, "tx_dbg");
  assert.equal(p.type, "BitIn");
  assert.ok(ends(topOnDisk().bindings).includes("tx_dbg uart.tx_dbg"));
  assert.equal(
    await E(page, `sheetLayout('${TOP}').edge.tx_dbg.side`),
    "right",
  );
});

test("click a sheet port, then a component: a new port there, bound", async () => {
  await E(page, "S.armed = { kind: 'edge', port: 'tx_dbg' }");
  await E(page, "connectArmed({ part: 'temp_if' })");
  assert.equal(portOnDisk(SUBS, "TempSensorInterface", "tx_dbg").type, "BitIn");
  assert.ok(ends(topOnDisk().bindings).includes("tx_dbg temp_if.tx_dbg"));
});

test("two components in one column are refused, and nothing changes", async () => {
  await saved(page).catch(() => {}); // settle any layout save from the last test
  const before = JSON.stringify(topOnDisk());
  await E(page, "quickConnect('adc_if', 'dac_if')");
  assert.match(
    await E(page, "document.getElementById('hint').textContent"),
    /same column/,
  );
  assert.equal(JSON.stringify(topOnDisk()), before);
});
