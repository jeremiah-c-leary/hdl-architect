// The Actions tab (actionstable.js, actionhops.js): the table that edits a
// performed action. A row per action (its part usage, action def, and the
// ports it uses); between the rows the hops, each the item that goes from one
// action to the next over a wire, chosen once. The table is built by clicking
// source ports on the sheet. The data is the frozen Wi-Fi fixture, then the
// user's first three rows of their ReadTemperature (2026-11-26), clicked in.
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
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

/** Choose `value` in the table's picker `role` ("hop0|item", "draft1|actionDef", ...). */
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

/** Click a port on the sheet: a part's ("ethernet", "Interrupt"), or the sheet's own (null, "eth_rgmii"). */
async function clickPort(part, port) {
  const selector = part
    ? `rect[data-part="${part}"][data-port="${port}"]`
    : `rect[data-edge="${port}"]`;
  await page.click(selector);
}

async function settled() {
  await saved(page);
  await E(page, "refreshActions()");
}

/** An action def, wherever it is: a new one goes in its performer's package. */
function actionDef(name) {
  for (const file of readdirSync(server.dir).filter(isModelFile)) {
    const defs = readModel(server.dir, file).package.actionDefs || [];
    const found = defs.find((def) => def.name === name);
    if (found) return found;
  }
  return undefined;
}

function isModelFile(file) {
  return file.endsWith(".json") && !file.endsWith(".layout.json");
}

test("the Actions tab lists today's actions, and the hops between them", async () => {
  await E(page, "openActions('readTemperature')");
  assert.equal(
    await E(
      page,
      "getComputedStyle(document.getElementById('seqSvg')).display",
    ),
    "none",
    "the diagram is hidden on the Actions tab",
  );
  assert.deepEqual(await texts("#actionsTable .at-name"), [
    "receiveFrame",
    "decodeCommand",
    "readSensor",
    "buildResponse",
    "sendFrame",
  ]);
  const hops = await texts("#actionsTable .at-hop-ends");
  assert.equal(hops[0], "eth_rgmii (sheet) ──▶ 1 ethernet.eth_rgmii");
  assert.equal(hops[1], "1 ethernet.cmd ──▶ 2 processing.Control");
  assert.equal(hops.at(-1), "5 ethernet.eth_rgmii ──▶ eth_rgmii (sheet)");
  const missing = await texts("#actionsTable .at-hop .at-missing");
  assert.equal(missing.length, 4, "four hops with no wire");
});

test("clicking source ports builds the user's first rows, one hop each", async () => {
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

  // Row 1: the frame comes in by the sheet's eth_rgmii.
  await clickPort(null, "eth_rgmii");
  assert.deepEqual(await texts("#actionsTable .at-hop-ends"), [
    "eth_rgmii (sheet) ──▶ 1 ethernet.eth_rgmii",
  ]);
  assert.equal(
    (await texts("#actionsTable .at-draft td"))[1],
    "ethernet : Ethernet",
  );
  await choose("hop0|item", "(new item)");
  await newItem("ethPacket", "EthPacket");
  await choose("draft0|actionDef", "ReceiveFrame");
  await settled();
  assert.deepEqual(await texts("#actionsTable .at-name"), ["receiveFrame"]);

  // Row 2: the interrupt, from ethernet to Control. Row 3 is clicked before
  // row 2 is saved: its hop waits for row 2's.
  await clickPort("ethernet", "Interrupt");
  await choose("hop0|item", "(new item)");
  await newItem("int", "Int");
  await clickPort("Control", "ethernet"); // ETH CSR, wired to ethernet.cmd
  await choose("hop1|item", "(new item)");
  await newItem("axi4liteRead", "Axi4LiteRead");
  await E(page, "window.prompt = () => 'RxFrameReq'");
  await choose("draft1|actionDef", "(new action def)");
  assert.match(
    (await texts("#actionsTable .at-wait"))[1],
    /Choose row 2's action def|Waits for the hop into row 2/,
  );
  await E(page, "window.prompt = () => 'ReadFrame'");
  await choose("draft0|actionDef", "(new action def)");
  await waitFor(
    async () => (await texts("#actionsTable .at-name")).length === 3,
    "both hops saved",
  );
  await settled();
  assert.deepEqual(await texts("#actionsTable .at-name"), [
    "receiveFrame",
    "readFrame",
    "rxFrameReq",
  ]);
  const readTemperature = actionDef("ReadTemperature");
  assert.deepEqual(readTemperature.flows, [
    { from: "receiveFrame.int", to: "readFrame.int", succession: true },
    {
      from: "readFrame.axi4liteRead",
      to: "rxFrameReq.axi4liteRead",
      succession: true,
    },
  ]);
  assert.deepEqual(readTemperature.bindings, [
    { ends: ["receiveFrame.ethPacket", "ethPacket"] },
  ]);
});

test("undo takes back a whole hop", async () => {
  await E(page, "undo()");
  await settled();
  assert.deepEqual(await texts("#actionsTable .at-name"), [
    "receiveFrame",
    "readFrame",
  ]);
});

test("another item def on a saved hop replaces it at both ends, after asking", async () => {
  await E(page, "window.confirm = () => true");
  await choose("receiveFrame.int>readFrame.int|item", "(new item)");
  await newItem("irq", "Irq");
  await settled();
  const items = (name) =>
    actionDef(name).parameters.map((item) => `${item.name} : ${item.type}`);
  assert.ok(items("ReceiveFrame").includes("irq : Irq"));
  assert.ok(!items("ReceiveFrame").includes("int : Int"));
  assert.deepEqual(items("ReadFrame"), ["irq : Irq"]);
});

test("right-click a port offers to remove its items nothing uses", async () => {
  // The old int : Int is still on the Interrupt port, unused since the replace.
  await E(
    page,
    `[...document.querySelectorAll("#actionsTable .at-port")]
      .find((tag) => tag.textContent === "Interrupt")
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }))`,
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

test("+ Action adds a row by hand: the part usage, then the action def", async () => {
  await E(page, "document.getElementById('atAddAction').click()");
  assert.ok(
    (await texts("#actionsTable .at-draft .at-muted")).includes(
      "Choose the part usage that performs it.",
    ),
  );
  await choose("draft0|part", "temp_if");
  await choose("draft0|actionDef", "ReadSensor");
  await settled();
  assert.deepEqual(await texts("#actionsTable .at-name"), [
    "receiveFrame",
    "readFrame",
    "readSensor",
  ]);
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
      .filter((b) => b.textContent === "✕")[2].click()`,
  );
  await settled();
  assert.deepEqual(await texts("#actionsTable .at-name"), [
    "receiveFrame",
    "readFrame",
  ]);
});

test("the Sequence tab shows the same actions", async () => {
  await E(page, "showTab('sequence')");
  assert.deepEqual(await texts("#seqSvg .seq-step-name"), [
    "1 receiveFrame",
    "2 readFrame",
  ]);
  await E(page, "showTab('actions')");
});

test("on the Sequence tab, a click on a port grows the diagram", async () => {
  await E(page, "showTab('sequence')");
  assert.match(
    await E(page, "document.getElementById('seqPending').textContent"),
    /^Click a port on the sheet/,
  );
  await clickPort("Control", "ethernet"); // ETH CSR, wired to ethernet.cmd
  await choose("hop0|item", "(new item)");
  await newItem("axi4liteRead", "Axi4LiteRead");
  await E(page, "window.prompt = () => 'RxFrameReq'");
  await choose("draft0|actionDef", "(new action def)");
  await settled();
  await waitFor(
    async () => (await texts("#seqSvg .seq-step-name")).length === 3,
    "the new action in the diagram",
  );
  assert.deepEqual(await texts("#seqSvg .seq-step-name"), [
    "1 receiveFrame",
    "2 readFrame",
    "3 rxFrameReq",
  ]);
  await E(page, "showTab('actions')");
});

test("the view docks under the sheet, which stays in sight", async () => {
  await E(page, "openActions('readTemperature')");
  const boxes = await E(
    page,
    `(() => {
      const box = (id) => document.getElementById(id).getBoundingClientRect();
      const sheet = box("canvasWrap");
      const dock = box("sequenceView");
      return { sheetHeight: sheet.height, sheetBottom: sheet.bottom, dockTop: dock.top };
    })()`,
  );
  assert.ok(boxes.sheetHeight > 100, "the sheet has room above the dock");
  assert.ok(
    boxes.sheetBottom <= boxes.dockTop + 1,
    "the dock does not cover it",
  );

  // Footprint lights the sheet and leaves the table open.
  await E(page, "document.getElementById('seqFootprint').click()");
  assert.equal(
    await E(page, "document.getElementById('sequenceView').hidden"),
    false,
  );
  assert.ok((await texts("#canvas .fp-badge")).length > 0, "the footprint");
  await E(page, "hideFootprint()");

  // Another sheet does not perform this action: the dock closes.
  await E(page, "openSheet('Control')");
  await waitFor(
    () => E(page, "document.getElementById('sequenceView').hidden"),
    "the dock closed",
  );
  await E(page, `openSheet(${JSON.stringify(TOP)})`);
});

test("with the dock closed, a click on a port wires as before", async () => {
  await clickPort("ethernet", "Interrupt");
  assert.match(
    await E(page, "document.getElementById('hint').textContent"),
    /^Wiring ethernet\.Interrupt/,
  );
  await E(page, "editor.armed = null");
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
