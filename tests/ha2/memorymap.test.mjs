// The memory map view (decision 14): its Map and Define tabs, the windows and
// root dialogs, and the menu entries that lead to them, on a frozen copy of
// FpgaOne (one root, ps.csr, and a crossbar with two windows).
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, test } from "node:test";
import {
  E,
  HERE,
  openPage,
  readModel,
  startServer,
  waitFor,
} from "./harness.mjs";

const FIXTURE = join(HERE, "fixtures", "fpga_one");
const TOP = "FpgaOne";
const FPGA_FILE = "fpgas/fpga_one/fpga_one.json";
const PS_FILE = "ip/zynq_ps/zynq_ps.json";
const DIALOG = "dialog.mm-dialog";

let server, page;

before(async () => {
  server = await startServer(FIXTURE);
  page = await openPage(server.url, TOP);
});
after(async () => {
  assert.deepEqual(page.errors, [], "no errors in the page");
  await server.stop();
});

const CLICK = "{ clientX: 40, clientY: 40, preventDefault() {} }";

const text = (id) => E(page, `document.getElementById('${id}').innerText`);

async function menuText() {
  await page.waitForSelector("#menu:not([hidden])");
  return E(page, "document.getElementById('menu').innerText");
}

/** The FPGA sheet's connection between two ends, from the file. */
function connection(ends) {
  const fpga = readModel(server.dir, FPGA_FILE).package.partDefs.find(
    (definition) => definition.name === TOP,
  );
  return fpga.connections.find((wire) => wire.ends.join() === ends.join());
}

async function mapShows(fragment) {
  await waitFor(
    async () => (await text("mmMap")).includes(fragment),
    `the map to show ${fragment}`,
  );
}

test("the Map tab lists the blocks in address order", async () => {
  await E(page, "openMemoryMap('map')");
  await mapShows("serial.regs");
  const shown = await text("mmMap");
  assert.match(shown, /Memory map ps: from FpgaOne\.ps\.csr, at 0x4000_0000/);
  assert.ok(shown.indexOf("csr") < shown.indexOf("serial.regs"));
  assert.match(shown, /0x4000_1000\s+serial\.regs/);
  assert.match(await text("mmNotes"), /No problems/);
});

test("the Define tab draws the tree with a window on each line", async () => {
  await E(page, "showMapTab('define')");
  const drawn = await E(page, "document.getElementById('mmSvg').textContent");
  for (const fragment of ["ps.csr", 'root "ps"', "crossbar", "serial.regs"])
    assert.ok(drawn.includes(fragment), `${fragment} in the tree`);
  assert.ok(drawn.includes("m1  0x4000_1000  4 KiB"), "m1's window label");
  const labels = await E(
    page,
    "document.querySelectorAll('.mm-label-edit').length",
  );
  assert.equal(labels, 2);
});

test("a window's label opens the crossbar's windows; Save sets it", async () => {
  await page.click(".mm-label-edit >> nth=1"); // m1
  await page.waitForSelector(DIALOG);
  const focused = await E(page, "document.activeElement.value");
  assert.equal(focused, "0x0000_1000", "m1's base has the cursor");
  await page.fill(`${DIALOG} tr:nth-child(3) input >> nth=0`, "0x2000");
  await page.click(`${DIALOG} button[value=ok]`);
  await waitFor(
    async () =>
      connection(["crossbar.m1", "serial.csr"]).attributes[0].redefines.base ===
      0x2000,
    "the window to be saved",
  );
  await E(page, "showMapTab('map')");
  await mapShows("0x4000_2000");
  assert.match(await text("mmMap"), /\(unused\)/, "the gap before it");
});

test("overlapping windows cannot be saved", async () => {
  await E(page, "(editWindows('FpgaOne', 'crossbar'), 0)");
  await page.waitForSelector(DIALOG);
  await page.fill(`${DIALOG} tr:nth-child(3) input >> nth=0`, "0x800");
  await waitFor(
    async () =>
      (
        await E(
          page,
          `document.querySelector('${DIALOG} .mm-dlg-problem').textContent`,
        )
      ).includes("overlap"),
    "the overlap to be shown",
  );
  await page.click(`${DIALOG} button[value=ok]`);
  assert.ok(
    await E(page, `Boolean(document.querySelector('${DIALOG}'))`),
    "still open",
  );
  await page.click(`${DIALOG} button[value=cancel]`);
  assert.equal(
    connection(["crossbar.m1", "serial.csr"]).attributes[0].redefines.base,
    0x2000,
  );
});

test("the root dialog renames the map and moves it", async () => {
  await E(page, "(editRoot('ZynqPs', 'csr'), 0)");
  await page.waitForSelector(DIALOG);
  await page.fill(`${DIALOG} input >> nth=0`, "cpu");
  await page.fill(`${DIALOG} input >> nth=1`, "0x8000_0000");
  await page.click(`${DIALOG} button[value=ok]`);
  await mapShows("Memory map cpu");
  const root = readModel(server.dir, PS_FILE).package.partDefs[0].ports.find(
    (port) => port.name === "csr",
  ).attributes[0];
  assert.deepEqual(root.redefines, { map_name: "cpu", base: 0x8000_0000 });
  assert.match(await text("mmMap"), /0x8000_2000\s+serial\.regs/);
});

test("the menus: a manager port's root, a crossbar's windows", async () => {
  await E(page, `partPortMenu(${CLICK}, 'ZynqPs', 'csr')`);
  assert.match(await menuText(), /Memory map root ✓ \(cpu\)…/);
  await E(page, `partPortMenu(${CLICK}, 'DeviceCsr', 'csr')`);
  assert.doesNotMatch(
    await menuText(),
    /Memory map root/,
    "not on a subordinate",
  );
  await E(page, `partMenu(${CLICK}, '${TOP}', 'crossbar')`);
  const crossbarMenu = await menuText();
  assert.match(crossbarMenu, /Crossbar ✓/);
  assert.match(crossbarMenu, /Memory map windows…/);
  await E(page, `partMenu(${CLICK}, '${TOP}', 'csr')`);
  const csrMenu = await menuText();
  assert.match(csrMenu, /Crossbar \(DeviceCsr, every instance\)/);
  assert.doesNotMatch(csrMenu, /Memory map windows/);
  await E(page, "hideMenu()");
});

test("a part def that is no longer a crossbar: the problem is listed", async () => {
  await E(page, "setCrossbar('AxiCrossbar1to2', false)");
  await waitFor(
    async () => (await text("mmNotes")).includes("is not a crossbar"),
    "the problem",
  );
  await E(page, "setCrossbar('AxiCrossbar1to2', true)");
  await waitFor(
    async () => (await text("mmNotes")).includes("No problems"),
    "no problems again",
  );
  const crossbar = readModel(
    server.dir,
    "ip/axi_crossbar/axi_crossbar.json",
  ).package.partDefs.find(
    (definition) => definition.name === "AxiCrossbar1to2",
  );
  assert.deepEqual(crossbar.specializes, ["VendorIp", "Crossbar"]);
});

test("a block in the Map tab goes to it on its sheet", async () => {
  await E(page, "showMapTab('map')");
  await page.click("#mmMap .mm-row:has-text('serial.regs')");
  assert.equal(await E(page, "editor.sheet"), "SerialSubsystem");
  assert.deepEqual(await E(page, "editor.sel"), { kind: "part", name: "regs" });
});
