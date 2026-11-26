// The device view: the design on every device of its family, as the banner's
// bars; the smallest that fits marked; "Use" retargets the FPGA
// (core.ops.set_device, through the server), and undo takes it back.
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, test } from "node:test";
import {
  E,
  HERE,
  TOP,
  openPage,
  readModel,
  startServer,
  waitFor,
} from "./harness.mjs";

const WITH_DEVICE = join(HERE, "fixtures", "wifi_router_estimates");
const FPGA = "wifi_packet_router_fpga.json";
let server, page;

before(async () => {
  server = await startServer(WITH_DEVICE);
  page = await openPage(server.url);
  await waitFor(async () => (await bannerText()).includes("XCZU9EG"), "banner");
});
after(async () => {
  assert.deepEqual(page.errors, [], "no errors in the page");
  await server.stop();
});

const bannerText = () =>
  E(page, "document.getElementById('resourceBanner').innerText");
const deviceOnDisk = () =>
  readModel(server.dir, FPGA)
    .package.partDefs.find((d) => d.name === TOP)
    .attributes.find((a) => a.name === "device").type;
/** One device's row: its classes, verdict, and each bar's fill level. */
const deviceRow = (device) =>
  E(
    page,
    `(() => {
      const row = document.querySelector('#dvTable tr[data-device=${device}]');
      return {
        classes: row.className,
        text: row.innerText.replace(/\\s+/g, ' ').trim(),
        bars: row.querySelectorAll('.rb-bar').length,
        lutLevel: row.querySelector('.rb-fill').className,
      };
    })()`,
  );
const rowCount = () =>
  E(page, "document.querySelectorAll('#dvTable .dv-row').length");

async function setUartLut(lut) {
  await E(page, "(window.__estimate = editEstimate('Uart'), 0)");
  await E(
    page,
    `document.querySelector('#estimateDlg input[name=lut]').value = '${lut}'`,
  );
  await E(
    page,
    "document.querySelector('#estimateDlg button[value=ok]').click()",
  );
  await E(page, "window.__estimate");
}

test("Devices… sits left of the device name in the banner", async () => {
  const order = await E(
    page,
    "[...document.getElementById('resourceBanner').children].slice(0, 2).map((e) => e.className)",
  );
  assert.deepEqual(order, ["rb-devices", "rb-device"]);
});

test("the view: every device of the family, smallest first, as bars", async () => {
  await E(page, "document.querySelector('.rb-devices').click()");
  await waitFor(async () => (await rowCount()) === 25, "25 devices");
  assert.match(
    await E(page, "document.getElementById('dvTitle').textContent"),
    /WifiPacketRouterFpga on ZynqUltraScalePlusResources/,
  );
  const first = await deviceRow("XCZU1CG");
  assert.equal(first.bars, 7);
  assert.match(first.classes, /dv-smallest/);
  assert.match(first.text, /smallest that fits/);
  assert.match(first.lutLevel, /rb-level-ok/);
  const target = await deviceRow("XCZU9EG");
  assert.match(target.classes, /dv-target/);
  assert.match(target.text, /fits target$/);
  assert.match(
    await E(page, "document.getElementById('dvNote').textContent"),
    /5 blocks to break down or estimate/,
  );
});

test("the view follows an estimate: the ZU1 now uses its margin", async () => {
  await setUartLut(30000);
  await waitFor(
    async () => (await deviceRow("XCZU1CG")).text.includes("uses margin"),
    "the ZU1 in its margin",
  );
  assert.match((await deviceRow("XCZU1CG")).lutLevel, /rb-level-margin/);
  assert.match((await deviceRow("XCZU2CG")).classes, /dv-smallest/);
  await setUartLut(250);
});

test("Use makes a device the target; the banner follows; undo takes it back", async () => {
  await E(
    page,
    "document.querySelector('#dvTable tr[data-device=XCZU3EG] button').click()",
  );
  await waitFor(async () => deviceOnDisk() === "XCZU3EG", "XCZU3EG on disk");
  await waitFor(async () => (await bannerText()).includes("XCZU3EG"), "banner");
  await waitFor(
    async () => (await deviceRow("XCZU3EG")).classes.includes("dv-target"),
    "the view's new target",
  );
  await E(page, "undo()");
  await waitFor(async () => deviceOnDisk() === "XCZU9EG", "undone on disk");
  await waitFor(async () => (await bannerText()).includes("XCZU9EG"), "banner");
});

test("Escape closes the view", async () => {
  await E(
    page,
    "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))",
  );
  assert.equal(
    await E(page, "document.getElementById('deviceView').hidden"),
    true,
  );
});
