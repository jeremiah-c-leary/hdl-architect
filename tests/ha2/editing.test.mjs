// Port names and descriptions: what HA 2 saves, and what comes back.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { E, openPage, readModel, saved, startServer } from "./harness.mjs";

const FPGA = "wifi_packet_router_fpga.json";
const SUBS = "wifi_packet_router_subsystems.json";
let server, w;

before(async () => {
  server = await startServer();
  w = await openPage(server.url);
});
after(() => server.stop());

const defIn = (file, name) =>
  readModel(server.dir, file).package.partDefs.find((d) => d.name === name);
const portIn = (file, def, ident) =>
  defIn(file, def).ports.find((p) => (p.shortName || p.name) === ident);

test("a description is saved as SysML doc, trimmed; an empty one removes it", async () => {
  w.askText = async () =>
    "  Converted samples to processing.\n   One beat per pair.  ";
  await w.editDoc("t", () =>
    E(w, "portsOfDef('AdcInterface').find(p => p.name === 'processing')"),
  );
  await saved(w);
  assert.equal(
    portIn(SUBS, "AdcInterface", "processing").doc,
    "Converted samples to processing.\nOne beat per pair.",
  );
  w.askText = async () => "";
  await w.editDoc("t", () =>
    E(w, "portsOfDef('AdcInterface').find(p => p.name === 'processing')"),
  );
  await saved(w);
  assert.equal(portIn(SUBS, "AdcInterface", "processing").doc, undefined);
});

test("a component's description goes on its definition", async () => {
  w.askText = async () => "Receives the ADC samples.";
  await w.editDoc("t", () => E(w, "partDef('AdcInterface')"));
  await saved(w);
  assert.equal(defIn(SUBS, "AdcInterface").doc, "Receives the ADC samples.");
});

test("a port's name is saved as SysML name + shortName, and comes back", async () => {
  w.prompt = () => "Board IRQ";
  w.editLabel("Control", "dac_irq");
  await saved(w);
  const p = portIn(FPGA, "Control", "dac_irq");
  assert.equal(p.name, "Board IRQ");
  assert.equal(p.shortName, "dac_irq");
  const again = await openPage(server.url);
  const q = E(again, "portsOfDef('Control').find(p => p.name === 'dac_irq')");
  assert.equal(q.label, "Board IRQ");
});

test("setting a port's interface keeps its name", async () => {
  w.prompt = () => "Spare";
  E(
    w,
    "mutate(() => { partDef('Uart').ports.push({ name: 'spare' }); addPortLayout('Uart', 'spare', 'left'); })",
  );
  w.editLabel("Uart", "spare");
  E(w, "setPortType('Uart', 'spare', 'BitIn')");
  await saved(w);
  const p = portIn(SUBS, "Uart", "spare");
  assert.deepEqual([p.name, p.shortName, p.type], ["Spare", "spare", "BitIn"]);
});

test("typing in the text box does not trigger the single-key shortcuts", () => {
  E(w, "S.sel = { kind: 'part', name: 'adc_if' }");
  const before = E(w, "JSON.stringify(S.pkgs.map(p => p.layout))");
  const ta = w.document.getElementById("textDlgText");
  ta.dispatchEvent(new w.KeyboardEvent("keydown", { key: "f", bubbles: true }));
  assert.equal(E(w, "JSON.stringify(S.pkgs.map(p => p.layout))"), before);
});
