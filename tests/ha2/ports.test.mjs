// Adding, renaming and deleting ports (core.ops, through the server): the
// model changes on disk at once; the drawing keeps up.
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
const portOnDisk = (def, ident) =>
  (defOnDisk(SUBS, def).ports || []).find(
    (p) => (p.shortName || p.name) === ident,
  );
const topWires = () => {
  const d = defOnDisk(FPGA, TOP);
  return [...(d.connections || []), ...(d.bindings || [])].map((w) =>
    w.ends.join(" "),
  );
};

test("a new port is on disk at once and drawn on the side asked for", async () => {
  await E(page, "newPort('Uart', 'spare', 'right')");
  assert.ok(portOnDisk("Uart", "spare"));
  assert.equal(await E(page, "portLayout('Uart', 'spare').side"), "right");
  await E(page, "newPort('Uart', 'spare', 'right')"); // taken: gets spare_2
  assert.ok(portOnDisk("Uart", "spare_2"));
});

test("renaming a port updates its wires and clock pairing, and it stays where it was", async () => {
  const before = await E(
    page,
    "JSON.stringify(portLayout('AdcInterface', 'ref_clk'))",
  );
  await E(page, "renamePort('AdcInterface', 'ref_clk', 'jesd_clk')");
  assert.ok(portOnDisk("AdcInterface", "jesd_clk"));
  assert.ok(topWires().includes("jesd_refclk adc_if.jesd_clk"));
  assert.equal(
    portOnDisk("AdcInterface", "sysref").redefines.clock_port,
    "jesd_clk",
  );
  assert.equal(
    await E(page, "JSON.stringify(portLayout('AdcInterface', 'jesd_clk'))"),
    before,
  );
});

test("deleting a port removes its wires and its place in the layout", async () => {
  await E(page, "deletePort('AdcInterface', 'jesd_clk')");
  assert.equal(portOnDisk("AdcInterface", "jesd_clk"), undefined);
  assert.ok(!topWires().some((w) => w.includes("adc_if.jesd_clk")));
  assert.equal(
    await E(
      page,
      "!!(layoutOf(pkgOf('AdcInterface')).ports.AdcInterface || {}).jesd_clk",
    ),
    false,
  );
  assert.match(
    await E(page, "document.getElementById('hint').textContent"),
    /Removed 1 wire\(s\).*sysref is no longer paired with a clock/,
  );
});
