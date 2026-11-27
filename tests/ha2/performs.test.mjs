// Performed actions in HA 2 (read-only): the Performs section of the side
// panel, the sequence view (lifelines, steps, items, ▶ to expand a part
// whose steps are broken down) and the footprint on the sheet. The data is
// the core's (core.actions, GET /api/actions).
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { E, HERE, openPage, saved, startServer, waitFor } from "./harness.mjs";

const FIXTURE = join(HERE, "fixtures", "wifi_router_estimates");
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
    `[...document.querySelectorAll(${JSON.stringify(selector)})].map((n) => n.textContent)`,
  );

test("the Performs section lists what the sheet performs, and how far it is", async () => {
  const text = await E(page, "document.getElementById('performs').innerText");
  assert.match(text, /readTemperature : ReadTemperature/);
  assert.match(text, /5 actions/);
  assert.match(text, /4 to break down · 1 performed · ⚠ 4 missing wires/);
});

test("the sequence view: a lifeline per part, the steps in order, the items", async () => {
  await E(page, "openSequence('readTemperature')");
  assert.deepEqual(await texts("#seqSvg .seq-lane-name"), [
    "(boundary)",
    "ethernet",
    "processing",
    "temp_if",
  ]);
  assert.deepEqual(await texts("#seqSvg .seq-step-name"), [
    "1 receiveFrame",
    "2 decodeCommand",
    "3 readSensor",
    "4 buildResponse",
    "5 sendFrame",
  ]);
  const missing = await texts("#seqSvg .seq-missing .seq-label");
  assert.equal(missing.length, 4, "four items with no wire");
  assert.match(missing[0], /^cmd : Command/);
  assert.equal(
    (await texts("#seqSvg .seq-wired")).length,
    2,
    "in and out at the edge",
  );
  await E(page, "closeSequence()");
});

test("the footprint dims what the action does not use and draws the missing wires", async () => {
  await E(page, "showFootprint('readTemperature')");
  const dimmed = await E(
    page,
    "[...document.querySelectorAll('#canvas g.fp-dim rect.comp')].map((r) => r.dataset.part)",
  );
  assert.ok(dimmed.includes("uart"), "uart performs no step");
  assert.ok(!dimmed.includes("ethernet") && !dimmed.includes("temp_if"));
  assert.deepEqual((await texts("#canvas .fp-badge")).sort(), [
    "action 3",
    "actions 1, 5",
    "actions 2, 4",
  ]);
  assert.equal((await texts("#canvas .fp-missing")).length, 4);
  assert.equal(
    await E(page, "document.getElementById('footprintBar').hidden"),
    false,
  );
  await E(page, "hideFootprint()");
  assert.equal((await texts("#canvas .fp-dim")).length, 0);
  assert.equal(
    await E(page, "document.getElementById('footprintBar').hidden"),
    true,
  );
});

test("▶ expands a part whose step is broken down into its parts' lifelines", async () => {
  // Break receiveFrame down inside Ethernet: two parts, a step on each.
  const operations = [
    ["add_part", { sheet: "Ethernet", name: "mac", kind: "Rtl" }],
    ["add_part", { sheet: "Ethernet", name: "parser", kind: "Rtl" }],
    [
      "add_step",
      {
        sheet: "Ethernet",
        perform: "receiveFrame",
        name: "rxMac",
        part: "mac",
      },
    ],
    [
      "add_step",
      {
        sheet: "Ethernet",
        perform: "receiveFrame",
        name: "parseFrame",
        part: "parser",
      },
    ],
  ];
  for (const [name, args] of operations)
    await E(page, `applyOp(${JSON.stringify(name)}, ${JSON.stringify(args)})`);
  await saved(page);
  await E(page, "refreshActions()");
  await E(page, "openSequence('readTemperature')");
  assert.ok(
    (await texts("#seqSvg .seq-lane-name")).includes("▶ ethernet"),
    "ethernet can expand",
  );
  await E(page, "toggleLane('ethernet')");
  await waitFor(
    async () => (await texts("#seqSvg .seq-bracket-name")).length === 1,
    "the bracket",
  );
  assert.deepEqual(await texts("#seqSvg .seq-bracket-name"), [
    "▼ ethernet : Ethernet",
  ]);
  assert.deepEqual(await texts("#seqSvg .seq-step-name"), [
    "1.1 rxMac",
    "1.2 parseFrame",
    "2 decodeCommand",
    "3 readSensor",
    "4 buildResponse",
    "5 sendFrame",
  ]);
  assert.deepEqual(await texts("#seqSvg .seq-lane-name"), [
    "(boundary)",
    "ethernet", // sendFrame: Ethernet still does it itself
    "mac",
    "parser",
    "processing",
    "temp_if",
  ]);
  await E(page, "collapseAll()");
  assert.equal((await texts("#seqSvg .seq-bracket-name")).length, 0);
  await E(page, "closeSequence()");
});

test("a sheet that performs nothing says so", async () => {
  await E(page, "openSheet('Control')");
  await E(page, "refreshActions()");
  const text = await E(page, "document.getElementById('performs').innerText");
  assert.match(text, /Performs no actions yet/);
});
