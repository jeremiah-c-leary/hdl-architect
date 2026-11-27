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

  // + Action, twice.
  for (const [name, part] of [
    ["receiveFrame", "ethernet"],
    ["readFrame", "Control"],
  ]) {
    await E(
      page,
      `(() => {
        document.getElementById("atNewName").value = ${JSON.stringify(name)};
        document.getElementById("atNewPart").value = ${JSON.stringify(part)};
        document.querySelector(".at-add button").click();
      })()`,
    );
    await settled();
  }
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

test("the Sequence tab shows the same action", async () => {
  await E(page, "showTab('sequence')");
  assert.deepEqual(await texts("#seqSvg .seq-step-name"), [
    "1 receiveFrame",
    "2 readFrame",
  ]);
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
