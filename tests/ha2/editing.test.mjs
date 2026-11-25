// Port names and descriptions: what HA 2 saves, and what comes back.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { E, openPage, readModel, saved, startServer } from "./harness.mjs";

const FPGA = "wifi_packet_router_fpga.json";
const SUBS = "wifi_packet_router_subsystems.json";
let server, page;

before(async () => {
  server = await startServer();
  page = await openPage(server.url);
});
after(async () => {
  assert.deepEqual(page.errors, [], "no errors in the page");
  await server.stop();
});

const defIn = (file, name) =>
  readModel(server.dir, file).package.partDefs.find((d) => d.name === name);
const portIn = (file, def, ident) =>
  defIn(file, def).ports.find((p) => (p.shortName || p.name) === ident);

/** Open the Description dialog for `target`, type `text`, click Save. */
async function describe(title, target, text) {
  const done = E(page, `editDoc(${JSON.stringify(title)}, ${target})`);
  await page.waitForSelector("#textDlg[open]");
  await page.fill("#textDlgText", text);
  await page.click("#textDlgOk");
  await done;
}

const ADC_PROCESSING = "{ def: 'AdcInterface', port: 'processing' }";

test("a description is saved as SysML doc, trimmed; an empty one removes it", async () => {
  await describe(
    "t",
    ADC_PROCESSING,
    "  Converted samples to processing.\n   One beat per pair.  ",
  );
  await saved(page);
  assert.equal(
    portIn(SUBS, "AdcInterface", "processing").doc,
    "Converted samples to processing.\nOne beat per pair.",
  );
  await describe("t", ADC_PROCESSING, "");
  await saved(page);
  assert.equal(portIn(SUBS, "AdcInterface", "processing").doc, undefined);
});

test("a component's description goes on its definition", async () => {
  await describe("t", "{ def: 'AdcInterface' }", "Receives the ADC samples.");
  await saved(page);
  assert.equal(defIn(SUBS, "AdcInterface").doc, "Receives the ADC samples.");
});

test("a port's name is saved as SysML name + shortName, and comes back", async () => {
  await E(page, "window.prompt = () => 'Board IRQ'");
  await E(page, "editLabel('Control', 'dac_irq')");
  await saved(page);
  const p = portIn(FPGA, "Control", "dac_irq");
  assert.equal(p.name, "Board IRQ");
  assert.equal(p.shortName, "dac_irq");
  const again = await openPage(server.url);
  const label = await E(
    again,
    "portsOfDef('Control').find(p => p.name === 'dac_irq').label",
  );
  assert.equal(label, "Board IRQ");
});

test("setting a port's interface keeps its name", async () => {
  await E(page, "window.prompt = () => 'Spare'");
  await E(
    page,
    "mutate(() => { partDef('Uart').ports.push({ name: 'spare' }); addPortLayout('Uart', 'spare', 'left'); })",
  );
  await E(page, "editLabel('Uart', 'spare')");
  await E(page, "setPortType('Uart', 'spare', 'BitIn')");
  await saved(page);
  const p = portIn(SUBS, "Uart", "spare");
  assert.deepEqual([p.name, p.shortName, p.type], ["Spare", "spare", "BitIn"]);
});

test("typing in the text box does not trigger the single-key shortcuts", async () => {
  await E(page, "S.sel = { kind: 'part', name: 'adc_if' }");
  const layouts = "JSON.stringify(S.pkgs.map(p => p.layout))";
  const before = await E(page, layouts);
  await E(
    page,
    "document.getElementById('textDlgText').dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }))",
  );
  assert.equal(await E(page, layouts), before);
});
