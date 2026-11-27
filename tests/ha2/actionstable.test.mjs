// Building a performed action (actionwalk.js) and the table that edits it
// (actionstable.js, actionhops.js). The walk: click the sheet port the
// request comes in by, then each part it reaches, picking what it does. The
// table: a row per action; between the rows the hops, each the item that goes
// from one action to the next over a wire, chosen once. The data is the
// frozen Wi-Fi fixture, then the user's first three rows of their
// ReadTemperature (2026-11-26), walked in.
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

/** The user's first three action defs, made with hops (so they know their ports), then no actions. */
async function threeActionDefs() {
  const hop = (source, target, item) => [
    "set_hop",
    { sheet: TOP, perform: "readTemperature", source, target, item },
  ];
  const setup = [
    ["add_port", { def: "Ethernet", name: "Interrupt", type: "BitOut" }],
    ["add_port", { def: "Control", name: "eth_int", type: "BitIn" }],
    ["connect", { sheet: TOP, a: "ethernet.Interrupt", b: "Control.eth_int" }],
  ];
  for (const step of TODAY)
    setup.push([
      "delete_step",
      { sheet: TOP, perform: "readTemperature", step },
    ]);
  for (const item of ["ethFrame", "cmd"])
    setup.push(["delete_action_item", { action: "ReceiveFrame", item }]);
  setup.push(
    hop(
      { step: null, port: "eth_rgmii" },
      {
        step: null,
        port: "eth_rgmii",
        new: { part: "ethernet", action: "ReceiveFrame" },
      },
      { name: "ethPacket", type: "EthPacket" },
    ),
    hop(
      { step: "receiveFrame", port: "Interrupt" },
      {
        step: null,
        port: "eth_int",
        new: { part: "Control", action: "ReadFrame" },
      },
      { name: "int", type: "Int" },
    ),
    hop(
      { step: "readFrame", port: "ethernet" },
      {
        step: null,
        port: "cmd",
        new: { part: "ethernet", action: "RxFrameReq" },
      },
      { name: "axi4liteRead", type: "Axi4LiteRead" },
    ),
  );
  for (const step of ["receiveFrame", "readFrame", "rxFrameReq"])
    setup.push([
      "delete_step",
      { sheet: TOP, perform: "readTemperature", step },
    ]);
  for (const [name, args] of setup)
    await E(page, `applyOp(${JSON.stringify(name)}, ${JSON.stringify(args)})`);
  await settled();
}

const TODAY = [
  "receiveFrame",
  "decodeCommand",
  "readSensor",
  "buildResponse",
  "sendFrame",
];

/** Click a part's box on the sheet. */
async function clickPart(part) {
  await page.click(`rect.comp[data-part="${part}"]`);
}

/** Pick an entry of the open menu. */
async function pick(label) {
  const entries = await texts("#menu .mi");
  assert.ok(entries.includes(label), entries.join(" | "));
  await E(
    page,
    `[...document.querySelectorAll("#menu .mi")].find((entry) => entry.textContent === ${JSON.stringify(label)}).click()`,
  );
}

const hint = () => E(page, "document.getElementById('hint').textContent");
const badges = () => texts("#canvas .fp-badge");

test("the walk: the sheet port, then each part it reaches", async () => {
  await threeActionDefs();
  await E(page, "openSequence('readTemperature')");
  assert.ok((await texts("#canvas g.fp-dim")).length > 0, "footprint on");
  assert.match(await hint(), /^Click the sheet port the request comes in by/);

  // The request comes in by the sheet's eth_rgmii: ethernet is next.
  await clickPort(null, "eth_rgmii");
  assert.deepEqual(await badges(), ["▶ next"]);
  assert.match(await hint(), /^▶ ethernet: click it/);

  // Only what comes in by eth_rgmii, one entry per exit.
  await clickPart("ethernet");
  await waitFor(
    async () => !(await E(page, "document.getElementById('menu').hidden")),
    "the menu, still open after the click",
  );
  await page.waitForTimeout(100);
  assert.equal(
    await E(page, "document.getElementById('menu').hidden"),
    false,
    "the menu stays open",
  );
  assert.equal((await texts("#menu .hd"))[0], "ethernet: in by eth_rgmii");
  assert.deepEqual(await texts("#menu .mi"), [
    "ReceiveFrame → Interrupt",
    "New action…",
  ]);
  await pick("ReceiveFrame → Interrupt");
  await settled();
  assert.deepEqual(await texts("#seqSvg .seq-step-name"), ["1 receiveFrame"]);
  assert.match(await hint(), /^▶ Control: click it .* eth_int/);

  await clickPart("Control");
  await waitFor(
    async () => !(await E(page, "document.getElementById('menu').hidden")),
    "the menu",
  );
  await pick("ReadFrame → ETH CSR");
  await settled();
  await clickPart("ethernet");
  await waitFor(
    async () => !(await E(page, "document.getElementById('menu').hidden")),
    "the menu",
  );
  await pick("RxFrameReq (leaves by no port)"); // its exit is not said yet
  await settled();
  assert.deepEqual(await texts("#seqSvg .seq-step-name"), [
    "1 receiveFrame",
    "2 readFrame",
    "3 rxFrameReq",
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

test("a click on a part the walk is not at selects it, as before", async () => {
  await clickPart("temp_if");
  assert.match(await hint(), /^Selected temp_if/);
  await E(page, "editor.sel = null");
});

test("undo takes back the last pick; the walk is back a part", async () => {
  await E(page, "undo()");
  await settled();
  assert.deepEqual(await texts("#seqSvg .seq-step-name"), [
    "1 receiveFrame",
    "2 readFrame",
  ]);
  assert.ok((await badges()).some((text) => text.endsWith("▶ next")));
  await E(page, "showTab('actions')");
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
  assert.ok(items("ReadFrame").includes("irq : Irq"));
  assert.ok(!items("ReadFrame").includes("int : Int"));
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

  // The footprint is on with the dock; its button turns it off and on.
  assert.ok((await texts("#canvas .fp-badge")).length > 0, "the footprint");
  await E(page, "document.getElementById('seqFootprint').click()");
  assert.equal((await texts("#canvas .fp-badge")).length, 0, "off");
  assert.equal(
    await E(page, "document.getElementById('sequenceView').hidden"),
    false,
  );
  await E(page, "document.getElementById('seqFootprint').click()");
  assert.ok((await texts("#canvas .fp-badge")).length > 0, "on again");

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

test("New action… at a part: a new action def, its items with no item def yet", async () => {
  await E(page, "openSequence('readTemperature')");
  await waitFor(
    async () => /^▶ ethernet: click it .* cmd/.test(await hint()),
    "the walk's hint, once the sheet's actions are in",
  );
  await clickPart("ethernet");
  await menuShowing("ethernet: in by cmd");
  await E(page, "window.prompt = () => 'GetTemp'");
  await pick("New action…");
  await menuShowing("GetTemp: leaves by");
  await pick("cmd");
  await settled();
  assert.deepEqual(await texts("#seqSvg .seq-step-name"), [
    "1 receiveFrame",
    "2 readFrame",
    "3 getTemp",
  ]);
  assert.deepEqual(actionDef("GetTemp").parameters, [
    { name: "cmd", direction: "in" },
    { name: "cmd_2", direction: "out" },
  ]);
  assert.match(await hint(), /^▶ Control: click it/);
  await E(page, "closeSequence()");
});

/** Wait for the menu to show, headed `head`. */
async function menuShowing(head) {
  await waitFor(
    async () =>
      !(await E(page, "document.getElementById('menu').hidden")) &&
      (await texts("#menu .hd"))[0] === head,
    `the menu "${head}"`,
  );
}

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
  // The dock opens on it, footprint on, ready to walk.
  await waitFor(
    async () =>
      !(await E(page, "document.getElementById('sequenceView').hidden")),
    "the dock open",
  );
  assert.match(
    await E(page, "document.getElementById('seqTitle').textContent"),
    /^reportStatus : ReportStatus/,
  );
  assert.equal(
    await E(page, "document.getElementById('footprintBar').hidden"),
    false,
    "footprint on",
  );
});
