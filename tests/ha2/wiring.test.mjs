// Wiring two existing ports: click one, then the other.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { E, TOP, openPage, readModel, saved, startServer } from "./harness.mjs";

let server, page;
// adc_if is in the first column, ethernet in a later one, dac_if shares adc_if's column
const L = "adc_if",
  R = "ethernet",
  SAME = "dac_if";
const col = (part) => E(page, `sheetLayout('${TOP}').parts['${part}'].col`);

before(async () => {
  server = await startServer();
  page = await openPage(server.url);
  assert.notEqual(await col(L), await col(R));
  assert.equal(await col(L), await col(SAME));
});
after(async () => {
  assert.deepEqual(page.errors, [], "no errors in the page");
  await server.stop();
});

const typeOf = (part) => E(page, `partType('${TOP}', '${part}')`);
const conns = () => E(page, `(partDef('${TOP}').connections || []).length`);
const binds = () => E(page, `(partDef('${TOP}').bindings || []).length`);
const end = (part, port) =>
  `{ kind: 'part', part: '${part}', port: '${port}' }`;
async function addPort(part, name, type) {
  const P = await typeOf(part);
  const u = type
    ? `{ name: '${name}', type: '${type}' }`
    : `{ name: '${name}' }`;
  await E(
    page,
    `mutate(() => { partDef('${P}').ports.push(${u}); addPortLayout('${P}', '${name}', 'left'); })`,
  );
}
const connect = (a, b) => E(page, `connectPorts(${a}, ${b})`);

test("two roles of one interface connect, and the ports turn to face each other", async () => {
  await addPort(L, "t_m", "Axi4LiteManager");
  await addPort(R, "t_s", "Axi4LiteSubordinate");
  const n = await conns();
  await connect(end(L, "t_m"), end(R, "t_s"));
  assert.equal(await conns(), n + 1);
  assert.equal(
    await E(page, `portLayout('${await typeOf(L)}', 't_m').side`),
    "right",
  );
  assert.equal(
    await E(page, `portLayout('${await typeOf(R)}', 't_s').side`),
    "left",
  );
});

test("a wire that already exists is refused", async () => {
  const n = await conns();
  await connect(end(L, "t_m"), end(R, "t_s"));
  assert.equal(await conns(), n);
});

test("two ports of the same role are refused, with an explanation", async () => {
  await addPort(L, "t_m2", "Axi4LiteManager");
  await addPort(R, "t_m3", "Axi4LiteManager");
  const n = await conns();
  await E(page, "window.__alerts.length = 0");
  await connect(end(L, "t_m2"), end(R, "t_m3"));
  assert.equal(await conns(), n);
  const alerts = await E(page, "window.__alerts");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /Axi4LiteManager goes with Axi4LiteSubordinate/);
});

test("a port with no interface takes the matching role", async () => {
  await addPort(R, "t_u");
  const n = await conns();
  await connect(end(L, "t_m2"), end(R, "t_u"));
  assert.equal(await conns(), n + 1);
  const P = await typeOf(R);
  assert.equal(
    await E(page, `portsOfDef('${P}').find(p => p.name === 't_u').type`),
    "Axi4LiteSubordinate",
  );
});

test("a sheet port and a component port bind (same interface)", async () => {
  await E(
    page,
    `mutate(() => { partDef('${TOP}').ports.push({ name: 't_edge', type: 'Axi4LiteSubordinate' }); sheetLayout('${TOP}').edge['t_edge'] = { side: 'left', y: 900 }; })`,
  );
  await addPort(R, "t_s2", "Axi4LiteSubordinate");
  const n = await binds();
  await connect("{ kind: 'edge', port: 't_edge' }", end(R, "t_s2"));
  assert.equal(await binds(), n + 1);
  assert.equal(
    await E(page, `sheetLayout('${TOP}').edge['t_edge'].side`),
    "right",
  );
});

test("two components in one column are refused", async () => {
  await addPort(L, "t_a", "Axi4LiteManager");
  await addPort(SAME, "t_b", "Axi4LiteSubordinate");
  const n = await conns();
  await connect(end(L, "t_a"), end(SAME, "t_b"));
  assert.equal(await conns(), n);
});

test("the wires are saved, and the model still checks", async () => {
  await saved(page);
  const top = readModel(
    server.dir,
    "wifi_packet_router_fpga.json",
  ).package.partDefs.find((d) => d.name === TOP);
  const mine = /(^|[ .])t_/; // the ports this file added (t_m, t_edge, ...)
  const ends = (list) =>
    (list || []).map((c) => c.ends.join(" ")).filter((s) => mine.test(s));
  assert.deepEqual(ends(top.connections), [
    `${L}.t_m ${R}.t_s`,
    `${L}.t_m2 ${R}.t_u`,
  ]);
  assert.deepEqual(ends(top.bindings), [`t_edge ${R}.t_s2`]);
  const check = await (await fetch(server.url + "api/check")).json();
  assert.deepEqual(check.errors, []);
  const problems = await E(
    page,
    "document.getElementById('problems').textContent",
  );
  assert.doesNotMatch(problems, /do not match/);
});
