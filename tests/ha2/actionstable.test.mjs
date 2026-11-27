// The Actions tab (actionstable.js): the table that edits a performed action,
// one row per action, each with its ingress and egress (a port of its part,
// and the item the port carries). "from" and "to" are worked out by the core
// from the wires. The data is the frozen Wi-Fi fixture, then the user's first
// two rows of their ReadTemperature (2026-11-26) entered through the table.
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, test } from "node:test";
import {
  E,
  HERE,
  openPage,
  readModel,
  saved,
  startServer,
  waitFor,
} from "./harness.mjs";

const FIXTURE = join(HERE, "fixtures", "wifi_router_estimates");
const TOP = "WifiPacketRouterFpga";
let server, page;

before(async () => {
  server = await startServer(FIXTURE);
  page = await openPage(server.url);
  await E(page, "refreshActions()");
});
after(async () => {
  assert.deepEqual(page.errors, [], "no errors in the page");
  await server.stop();
});

const texts = (selector) =>
  E(
    page,
    `[...document.querySelectorAll(${JSON.stringify(selector)})].map((n) => n.textContent.trim())`,
  );

/** Choose `value` in the table's picker `role` ("step|in|item|port", ...). */
async function choose(role, value) {
  await E(
    page,
    `(() => {
      const select = document.querySelector('select[data-role=${JSON.stringify(role)}]');
      select.value = ${JSON.stringify(value)};
      select.dispatchEvent(new Event("change"));
    })()`,
  );
}

/** Fill in the open "New item…" form and press OK. */
async function newItem(name, itemDef) {
  await E(
    page,
    `(() => {
      const [nameField, itemDefField] = document.querySelectorAll(".at-new-item input");
      nameField.value = ${JSON.stringify(name)};
      itemDefField.value = ${JSON.stringify(itemDef)};
      document.querySelector(".at-new-item button").click();
    })()`,
  );
}

/** The row cells of action `name`: {from, to, status} of its first line. */
function rowOf(name) {
  return E(
    page,
    `(() => {
      const row = [...document.querySelectorAll("#actionsTable tr.at-line")]
        .find((tr) => tr.querySelector(".at-name div")?.textContent === ${JSON.stringify(name)});
      const links = [...row.querySelectorAll(".at-link")].map((td) => td.textContent.trim());
      return { from: links[0], to: links[1], status: row.querySelector(".at-status").textContent.trim() };
    })()`,
  );
}

async function settled() {
  await saved(page);
  await E(page, "refreshActions()");
}

test("the Actions tab lists today's actions with their links", async () => {
  await E(page, "openActions('readTemperature')");
  assert.equal(
    await E(
      page,
      "getComputedStyle(document.getElementById('seqSvg')).display",
    ),
    "none",
    "the diagram is hidden on the Actions tab",
  );
  assert.deepEqual(await texts("#actionsTable .at-name div"), [
    "receiveFrame",
    "decodeCommand",
    "readSensor",
    "buildResponse",
    "sendFrame",
  ]);
  const first = await rowOf("receiveFrame");
  assert.equal(first.from, "sheet");
  assert.match(first.to, /^2 ⚠$/, "cmd to decodeCommand has no wire");
  assert.match((await rowOf("readSensor")).status, /^performed ⚠$/);
});

test("the user's first two rows, entered in the table, link over the new wire", async () => {
  // What the user does on the sheet first: the interrupt ports and wire, and
  // a ReadTemperature with no actions yet.
  const setup = [
    ["add_port", { def: "Ethernet", name: "Interrupt", type: "BitOut" }],
    ["add_port", { def: "Control", name: "eth_int", type: "BitIn" }],
    ["connect", { sheet: TOP, a: "ethernet.Interrupt", b: "Control.eth_int" }],
  ];
  for (const step of [
    "receiveFrame",
    "decodeCommand",
    "readSensor",
    "buildResponse",
    "sendFrame",
  ])
    setup.push([
      "delete_step",
      { sheet: TOP, perform: "readTemperature", step },
    ]);
  for (const item of ["ethFrame", "cmd"])
    setup.push(["delete_action_item", { action: "ReceiveFrame", item }]);
  for (const [name, args] of setup)
    await E(page, `applyOp(${JSON.stringify(name)}, ${JSON.stringify(args)})`);
  await settled();

  // + Action: the part usage first, then its action def. Ethernet performs
  // ReceiveFrame already; ReadFrame is a new action def.
  await E(page, "document.getElementById('atAddAction').click()");
  assert.deepEqual(await texts("#actionsTable .at-draft .at-muted"), [
    "Choose the part usage that performs it.",
  ]);
  await choose("draft0|part", "ethernet");
  const groups = await E(
    page,
    `[...document.querySelectorAll('select[data-role="draft0|actionDef"] optgroup')]
      .map((group) => group.label + ": " + [...group.children].map((o) => o.textContent).join(","))`,
  );
  assert.match(groups[0], /^Performed by ethernet: .*ReceiveFrame/);
  await choose("draft0|actionDef", "ReceiveFrame");
  await settled();
  await E(page, "document.getElementById('atAddAction').click()");
  await choose("draft0|part", "Control");
  await E(page, "window.prompt = () => 'ReadFrame'");
  await choose("draft0|actionDef", "(new action def)");
  await settled();
  assert.deepEqual(await texts("#actionsTable .at-name div"), [
    "receiveFrame",
    "readFrame",
  ]);

  // Row 1 egress: Interrupt, a new item int : Int.
  await choose("receiveFrame|out|+|port", "Interrupt");
  await choose("receiveFrame|out|+|item", "(new item)");
  await newItem("int", "Int");
  await settled();
  assert.equal((await rowOf("receiveFrame")).to, "nobody yet");

  // Row 2 ingress: eth_int, a new item int : Int. The core links it to row 1.
  await choose("readFrame|in|+|port", "eth_int");
  await choose("readFrame|in|+|item", "(new item)");
  await newItem("int", "Int");
  await settled();
  await waitFor(
    async () => (await rowOf("readFrame")).from === "1",
    "row 2 fed by row 1",
  );
  assert.equal((await rowOf("receiveFrame")).to, "2");

  const behaviour = readModel(server.dir, "wifi_packet_router_behavior.json");
  const readTemperature = behaviour.package.actionDefs.find(
    (def) => def.name === "ReadTemperature",
  );
  assert.deepEqual(readTemperature.flows, [
    { from: "receiveFrame.int", to: "readFrame.int", succession: true },
  ]);
});

test("undo takes back the last edit", async () => {
  await E(page, "undo()");
  await settled();
  assert.equal((await rowOf("readFrame")).from, "");
});

test("an item def changed on a line replaces the item, after asking", async () => {
  await E(page, "window.confirm = () => true");
  await E(page, "openActions('readTemperature')");
  await choose("receiveFrame|out|int|item", "(new item)");
  await newItem("irq", "Irq");
  await settled();
  const behaviour = readModel(server.dir, "wifi_packet_router_behavior.json");
  const receiveFrame = behaviour.package.actionDefs.find(
    (def) => def.name === "ReceiveFrame",
  );
  assert.deepEqual(
    receiveFrame.parameters.map((item) => `${item.name} : ${item.type}`),
    ["irq : Irq"],
  );
});

test("right-click offers to remove a port's item nothing uses", async () => {
  // The old int : Int is still on the Interrupt port, unused since the replace.
  await E(
    page,
    `document.querySelector('select[data-role="receiveFrame|out|irq|item"]')
      .parentElement.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }))`,
  );
  const entries = await texts("#menu .mi");
  const remove = "Remove unused int : Int from port Interrupt";
  assert.ok(entries.includes(remove), entries.join(" | "));
  await E(
    page,
    `[...document.querySelectorAll("#menu .mi")].find((entry) => entry.textContent === ${JSON.stringify(remove)}).click()`,
  );
  await settled();
  const subsystems = readModel(
    server.dir,
    "wifi_packet_router_subsystems.json",
  );
  const ethernet = subsystems.package.partDefs.find(
    (def) => def.name === "Ethernet",
  );
  const interrupt = ethernet.ports.find((port) => port.name === "Interrupt");
  assert.deepEqual(
    interrupt.items.map((item) => item.name),
    ["irq"],
  );
});

test("ReadTemperature's own items nothing uses can be removed", async () => {
  const own = await texts("#actionsTable .at-own-item");
  assert.ok(own.some((text) => text.startsWith("gets cmdFrame : EthFrame")));
  await E(
    page,
    `[...document.querySelectorAll("#actionsTable .at-own-item")]
      .find((tag) => tag.textContent.startsWith("gets cmdFrame")).querySelector("button").click()`,
  );
  await settled();
  const left = await texts("#actionsTable .at-own-item");
  assert.ok(!left.some((text) => text.startsWith("gets cmdFrame")));
});

test("✕ deletes an action", async () => {
  await E(page, "window.confirm = () => true");
  await E(
    page,
    `[...document.querySelectorAll("#actionsTable .at-number button")]
      .filter((b) => b.textContent === "✕")[1].click()`,
  );
  await settled();
  assert.deepEqual(await texts("#actionsTable .at-name div"), ["receiveFrame"]);
});

test("the Sequence tab shows the same action", async () => {
  await E(page, "showTab('sequence')");
  assert.deepEqual(await texts("#seqSvg .seq-step-name"), ["1 receiveFrame"]);
  await E(page, "closeSequence()");
});

test("+ Perform action… makes the sheet perform a new action def", async () => {
  await E(page, "openSheet('Control')");
  await E(page, "window.prompt = () => 'ReportStatus'");
  await E(page, "document.getElementById('addPerform').click()");
  await settled();
  await waitFor(
    async () =>
      /reportStatus : ReportStatus/.test(
        await E(page, "document.getElementById('performs').innerText"),
      ),
    "the new perform listed",
  );
});
