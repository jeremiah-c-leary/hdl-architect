// Setting a port's interface (core.ops.set_interface, through the server).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { E, TOP, openPage, readModel, saved, startServer } from "./harness.mjs";

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

const portOnDisk = (def, ident) =>
  readModel(server.dir, SUBS)
    .package.partDefs.find((d) => d.name === def)
    .ports.find((p) => (p.shortName || p.name) === ident);
async function addPort(P, name) {
  await E(
    page,
    `mutate(() => { partDef('${P}').ports.push({ name: '${name}' }); addPortLayout('${P}', '${name}', 'left'); })`,
  );
  await saved(page);
}
const hintText = () => E(page, "document.getElementById('hint').textContent");

test("an interface is set on disk at once, and an untyped far end gets the other role", async () => {
  await addPort("AdcInterface", "i_m");
  await addPort("Ethernet", "i_s");
  await E(
    page,
    `mutate(() => partDef('${TOP}').connections.push({ ends: ['adc_if.i_m', 'ethernet.i_s'] }))`,
  );
  await saved(page);
  await E(page, "setPortType('AdcInterface', 'i_m', 'Axi4LiteManager')");
  assert.equal(portOnDisk("AdcInterface", "i_m").type, "Axi4LiteManager");
  assert.equal(portOnDisk("Ethernet", "i_s").type, "Axi4LiteSubordinate");
  assert.match(
    await hintText(),
    /Also typed the other end: ethernet\.i_s : Axi4LiteSubordinate/,
  );
});

test("several picked ports get one interface in one step, and undo takes it back", async () => {
  await addPort("Uart", "i_1");
  await addPort("Uart", "i_2");
  const undos = await E(page, "editor.undo.length");
  await E(
    page,
    "setPortsType([{ P: 'Uart', port: 'i_1' }, { P: 'Uart', port: 'i_2' }], 'BitIn')",
  );
  assert.equal(await E(page, "editor.undo.length"), undos + 1);
  assert.equal(portOnDisk("Uart", "i_1").type, "BitIn");
  assert.equal(portOnDisk("Uart", "i_2").type, "BitIn");
  await E(page, "undo()");
  await saved(page);
  assert.equal(portOnDisk("Uart", "i_1").type, undefined);
  assert.equal(portOnDisk("Uart", "i_2").type, undefined);
});

test("an unknown interface is refused with a reason", async () => {
  await E(page, "setPortType('Uart', 'i_1', 'NoSuchDef')");
  assert.match(await hintText(), /no port def NoSuchDef/);
  assert.equal(portOnDisk("Uart", "i_1").type, undefined);
});
