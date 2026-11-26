// Resource estimates in HA 2: the Resources panel shows the core's roll-up for
// the open sheet; a leaf's estimate is entered from its right-click menu
// (core.ops.set_estimate, through the server); roll-up blocks cannot have one.
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
const SUBS = "wifi_packet_router_subsystems.json";
let server, page;

before(async () => {
  server = await startServer(WITH_DEVICE);
  page = await openPage(server.url);
  await waitFor(async () => (await panelText()).includes("XCZU9EG"), "panel");
});
after(async () => {
  assert.deepEqual(page.errors, [], "no errors in the page");
  await server.stop();
});

const panelText = () =>
  E(page, "document.getElementById('resources').innerText");
const menuText = (part) =>
  E(
    page,
    `(compMenu({ clientX: 10, clientY: 10 }, '${TOP}', '${part}'), document.getElementById('menu').innerText)`,
  );
const uartEstimate = () =>
  readModel(server.dir, SUBS)
    .package.partDefs.find((d) => d.name === "Uart")
    .attributes?.find((a) => a.type === "ZynqUltraScalePlusResources");

async function enterEstimate(defName, counts) {
  await E(page, `(window.__estimate = editEstimate('${defName}'), 0)`);
  for (const [name, value] of Object.entries(counts))
    await E(
      page,
      `document.querySelector('#estimateDlg input[name=${name}]').value = '${value}'`,
    );
  await E(
    page,
    "document.querySelector('#estimateDlg button[value=ok]').click()",
  );
  await E(page, "window.__estimate");
}

test("the panel shows each part, the sheet's total and the fit", async () => {
  const text = await panelText();
  assert.match(text, /XCZU9EG \(ZynqUltraScalePlusResources\)/);
  assert.match(text, /uart : Uart\s+lut 250 · ff 200/);
  assert.match(text, /ethernet : Ethernet\s+to break down/);
  assert.match(text, /Sheet total\s+lut 960 · ff 812/);
  assert.match(text, /Fit in XCZU9EG\s+lut 0%/);
});

test("a leaf offers an estimate; a roll-up block says it is the sum of its parts", async () => {
  assert.match(await menuText("uart"), /Estimate ✓…/);
  assert.match(await menuText("ethernet"), /Resources: the sum of its parts/);
  assert.match(
    await menuText("CLK_RST_CTRL"),
    /Resources: the sum of its parts/,
  );
  await E(page, "hideMenu()");
});

test("entering an estimate: on disk at once, and the panel follows", async () => {
  await enterEstimate("Uart", { lut: 400, dsp48: 3 });
  assert.deepEqual(uartEstimate().redefines, { lut: 400, ff: 200, dsp48: 3 });
  await waitFor(
    async () => (await panelText()).includes("lut 1110 · ff 812 · dsp48 3"),
    "the panel's new total",
  );
});

test("all zeros removes the estimate: the leaf is not estimated", async () => {
  await enterEstimate("Uart", { lut: 0, ff: 0, dsp48: 0 });
  assert.equal(uartEstimate(), undefined);
  await waitFor(
    async () => /uart : Uart\s+not estimated/.test(await panelText()),
    "uart not estimated",
  );
  assert.match(await menuText("uart"), /Estimate…/);
  await E(page, "hideMenu()");
});

test("undo puts the estimate back, and the panel follows", async () => {
  await E(page, "undo()");
  await waitFor(
    async () => uartEstimate() !== undefined,
    "estimate back on disk",
  );
  await waitFor(
    async () => /uart : Uart\s+lut 400/.test(await panelText()),
    "the panel after undo",
  );
});

test("Cancel changes nothing", async () => {
  const before = JSON.stringify(uartEstimate());
  await E(page, "(window.__estimate = editEstimate('Uart'), 0)");
  await E(
    page,
    "document.querySelector('#estimateDlg input[name=lut]').value = '9'",
  );
  await E(
    page,
    "document.querySelector('#estimateDlg button[value=cancel]').click()",
  );
  assert.equal(await E(page, "window.__estimate"), null);
  assert.equal(JSON.stringify(uartEstimate()), before);
});
