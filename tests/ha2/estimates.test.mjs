// Resource estimates in HA 2: the resource banner (a bar per resource, with
// its margin) and the utilization view (the hierarchy, Vivado style) show
// the core's roll-up; a leaf's estimate is entered from its right-click menu
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
const RTL_COLOR = "rgb(47, 143, 87)"; // #2f8f57, as the browser reports it
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
/** One resource in the banner: its percent, fill level, fill width, margin line. */
const bar = (name) =>
  E(
    page,
    `(() => {
      const item = [...document.querySelectorAll('.rb-resource')]
        .find((r) => r.querySelector('.rb-name').textContent === '${name}');
      const fill = item.querySelector('.rb-fill');
      const line = item.querySelector('.rb-margin-line');
      return {
        percent: item.querySelector('.rb-percent').textContent,
        level: fill && fill.className.replace('rb-fill ', ''),
        width: fill && fill.style.width,
        marginAt: line && line.style.left,
        tooltip: item.title,
      };
    })()`,
  );
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
const waitForBar = (name, percent) =>
  waitFor(
    async () => (await bar(name)).percent === percent,
    `${name} at ${percent}`,
  );

// ------------------------------------------------------------------ the banner

test("the banner: the device, a bar per resource with its margin line", async () => {
  const text = await bannerText();
  assert.match(text, /XCZU9EG/);
  assert.match(text, /⚠ 5 to break down/);
  const lut = await bar("lut");
  assert.equal(lut.percent, "0%");
  assert.equal(lut.level, "rb-level-ok");
  assert.equal(lut.marginAt, "70%");
  assert.equal(
    lut.tooltip,
    "960 of 274080 lut (0%); margin 30%: budget 191856",
  );
  assert.equal((await bar("bram36")).marginAt, "80%"); // the design's own margin
  assert.equal((await bar("uram")).percent, "none on device");
});

test("a bar turns amber in the margin and red past the device", async () => {
  await enterEstimate("Uart", { lut: 200000 });
  await waitForBar("lut", "73%");
  assert.equal((await bar("lut")).level, "rb-level-margin");
  await enterEstimate("Uart", { lut: 300000 });
  await waitForBar("lut", "110%");
  const lut = await bar("lut");
  assert.equal(lut.level, "rb-level-over");
  assert.equal(lut.width, "100%"); // the bar stops at the device's edge
  await enterEstimate("Uart", { lut: 250 });
  await waitForBar("lut", "0%");
});

// ------------------------------------------------------------------ the menu and the dialog

test("a leaf offers an estimate; a roll-up block says it is the sum of its parts", async () => {
  assert.match(await menuText("uart"), /Estimate ✓…/);
  assert.match(await menuText("ethernet"), /Resources: the sum of its parts/);
  assert.match(
    await menuText("CLK_RST_CTRL"),
    /Resources: the sum of its parts/,
  );
  await E(page, "hideMenu()");
});

test("entering an estimate: on disk at once, and the banner follows", async () => {
  await enterEstimate("Uart", { lut: 400, dsp48: 3 });
  assert.deepEqual(uartEstimate().redefines, { lut: 400, ff: 200, dsp48: 3 });
  await waitFor(
    async () => (await bar("lut")).tooltip.startsWith("1110 of"),
    "the banner's new lut total",
  );
});

test("all zeros removes the estimate: the leaf is not estimated", async () => {
  await enterEstimate("Uart", { lut: 0, ff: 0, dsp48: 0 });
  assert.equal(uartEstimate(), undefined);
  await waitFor(
    async () => (await bannerText()).includes("1 not estimated"),
    "uart not estimated",
  );
  assert.match(await menuText("uart"), /Estimate…/);
  await E(page, "hideMenu()");
});

test("undo puts the estimate back, and the banner follows", async () => {
  await E(page, "undo()");
  await waitFor(
    async () => uartEstimate() !== undefined,
    "estimate back on disk",
  );
  await waitFor(
    async () => !(await bannerText()).includes("not estimated"),
    "the banner after undo",
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

// ------------------------------------------------------------------ the utilization view

const rowTexts = () =>
  E(
    page,
    "[...document.querySelectorAll('#rvTable .rv-row')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim())",
  );
const rowOf = async (start) =>
  (await rowTexts()).find((r) => r.startsWith(start));

test("Hierarchy… opens the view: every block, its counts, tinted by kind", async () => {
  await E(page, "document.querySelector('.rb-hierarchy').click()");
  assert.equal(
    await E(page, "document.getElementById('resourceView').hidden"),
    false,
  );
  assert.match(
    await E(page, "document.getElementById('rvTitle').textContent"),
    /WifiPacketRouterFpga on XCZU9EG/,
  );
  assert.equal((await rowTexts()).length, 11); // the FPGA, its 9 parts, RST_SYNC
  assert.equal(await rowOf("uart : Uart"), "uart : Uart 400 200 0 0 3");
  assert.equal(
    await rowOf("ethernet : Ethernet"),
    "ethernet : Ethernet to break down",
  );
  assert.equal(
    await E(
      page,
      "document.querySelector('#rvTable .rv-row[data-path$=\".uart\"]').style.borderLeftColor",
    ),
    RTL_COLOR,
  );
});

test("folding a block hides its parts; percent instead of counts", async () => {
  await E(
    page,
    "document.querySelector('.rv-row[data-path$=\"CLK_RST_CTRL\"] .rv-fold').click()",
  );
  assert.equal(await rowOf("RST_SYNC"), undefined);
  assert.equal((await rowTexts()).length, 10);
  await E(page, "document.getElementById('rvToggle').click()");
  assert.match(await rowOf("uart : Uart"), /^uart : Uart 0% 0% 0% - 0%$/);
  await E(page, "document.getElementById('rvToggle').click()");
});

test("clicking a leaf's row opens the sheet it is on; Escape closes", async () => {
  await E(page, "openSheet('Control')");
  await E(page, "document.querySelector('.rb-hierarchy').click()");
  await E(
    page,
    "document.querySelector('.rv-row[data-path$=\".uart\"]').click()",
  );
  assert.equal(
    await E(page, "document.getElementById('resourceView').hidden"),
    true,
  );
  assert.equal(await E(page, "editor.sheet"), TOP);
  await E(page, "document.querySelector('.rb-hierarchy').click()");
  await E(
    page,
    "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))",
  );
  assert.equal(
    await E(page, "document.getElementById('resourceView').hidden"),
    true,
  );
});
