// Wiring two existing ports: click one, then the other.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { E, TOP, openPage, readModel, saved, startServer } from "./harness.mjs";

let server, w;
// adc_if is in the first column, ethernet in a later one, dac_if shares adc_if's column
const L = "adc_if",
  R = "ethernet",
  SAME = "dac_if";

before(async () => {
  server = await startServer();
  w = await openPage(server.url);
  assert.notEqual(
    E(w, `sheetLayout('${TOP}').parts['${L}'].col`),
    E(w, `sheetLayout('${TOP}').parts['${R}'].col`),
  );
  assert.equal(
    E(w, `sheetLayout('${TOP}').parts['${L}'].col`),
    E(w, `sheetLayout('${TOP}').parts['${SAME}'].col`),
  );
});
after(() => server.stop());

const typeOf = (part) => E(w, `partType('${TOP}', '${part}')`);
const conns = () => E(w, `(partDef('${TOP}').connections || []).length`);
const binds = () => E(w, `(partDef('${TOP}').bindings || []).length`);
const end = (part, port) =>
  `{ kind: 'part', part: '${part}', port: '${port}' }`;
function addPort(part, name, type) {
  const P = typeOf(part);
  const u = type
    ? `{ name: '${name}', type: '${type}' }`
    : `{ name: '${name}' }`;
  E(
    w,
    `mutate(() => { partDef('${P}').ports.push(${u}); addPortLayout('${P}', '${name}', 'left'); })`,
  );
}
const connect = (a, b) => E(w, `connectPorts(${a}, ${b})`);

test("two roles of one interface connect, and the ports turn to face each other", () => {
  addPort(L, "t_m", "Axi4LiteManager");
  addPort(R, "t_s", "Axi4LiteSubordinate");
  const n = conns();
  connect(end(L, "t_m"), end(R, "t_s"));
  assert.equal(conns(), n + 1);
  assert.equal(E(w, `portLayout('${typeOf(L)}', 't_m').side`), "right");
  assert.equal(E(w, `portLayout('${typeOf(R)}', 't_s').side`), "left");
});

test("a wire that already exists is refused", () => {
  const n = conns();
  connect(end(L, "t_m"), end(R, "t_s"));
  assert.equal(conns(), n);
});

test("two ports of the same role are refused, with an explanation", () => {
  addPort(L, "t_m2", "Axi4LiteManager");
  addPort(R, "t_m3", "Axi4LiteManager");
  const n = conns();
  w.__alerts.length = 0;
  connect(end(L, "t_m2"), end(R, "t_m3"));
  assert.equal(conns(), n);
  assert.equal(w.__alerts.length, 1);
  assert.match(w.__alerts[0], /Axi4LiteManager goes with Axi4LiteSubordinate/);
});

test("a port with no interface takes the matching role", () => {
  addPort(R, "t_u");
  const n = conns();
  connect(end(L, "t_m2"), end(R, "t_u"));
  assert.equal(conns(), n + 1);
  assert.equal(
    E(w, `portsOfDef('${typeOf(R)}').find(p => p.name === 't_u').type`),
    "Axi4LiteSubordinate",
  );
});

test("a sheet port and a component port bind (same interface)", () => {
  E(
    w,
    `mutate(() => { partDef('${TOP}').ports.push({ name: 't_edge', type: 'Axi4LiteSubordinate' }); sheetLayout('${TOP}').edge['t_edge'] = { side: 'left', y: 900 }; })`,
  );
  addPort(R, "t_s2", "Axi4LiteSubordinate");
  const n = binds();
  connect("{ kind: 'edge', port: 't_edge' }", end(R, "t_s2"));
  assert.equal(binds(), n + 1);
  assert.equal(E(w, `sheetLayout('${TOP}').edge['t_edge'].side`), "right");
});

test("two components in one column are refused", () => {
  addPort(L, "t_a", "Axi4LiteManager");
  addPort(SAME, "t_b", "Axi4LiteSubordinate");
  const n = conns();
  connect(end(L, "t_a"), end(SAME, "t_b"));
  assert.equal(conns(), n);
});

test("the wires are saved, and the model still checks", async () => {
  await saved(w);
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
  assert.doesNotMatch(
    w.document.getElementById("problems").textContent,
    /do not match/,
  );
});
