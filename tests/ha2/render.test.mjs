// What HA 2 draws, byte for byte: the top sheet, the Control sheet, the clock
// and reset trees, and the problem list, from the frozen Wi-Fi model. Like the
// VHDL golden files: a change to the drawing must be on purpose.
//
// To accept an intended change: UPDATE_GOLDEN=1 npm run test:ha2, then review
// the changed files in tests/ha2/golden/ (the .svg files open in a browser).
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { E, HERE, openPage, startServer } from "./harness.mjs";

const GOLDEN = join(HERE, "golden");
let server, page;

before(async () => {
  server = await startServer();
  page = await openPage(server.url);
});
after(async () => {
  assert.deepEqual(page.errors, [], "no errors in the page");
  await server.stop();
});

function matchesGolden(name, text) {
  const file = join(GOLDEN, name);
  if (process.env.UPDATE_GOLDEN) {
    mkdirSync(GOLDEN, { recursive: true });
    writeFileSync(file, text);
    return;
  }
  const want = readFileSync(file, "utf-8");
  assert.ok(
    text === want,
    `${name} differs from tests/ha2/golden/${name} ` +
      "(an intended change? UPDATE_GOLDEN=1 npm run test:ha2)",
  );
}

const svgOf = (id) =>
  E(page, `exportSvgText(document.getElementById('${id}')).text`);

test("the top sheet", async () => {
  matchesGolden("sheet-top.svg", await svgOf("canvas"));
});

test("the problem list of the top sheet", async () => {
  const text = await E(page, "document.getElementById('problems').textContent");
  matchesGolden("problems-top.txt", text + "\n");
});

test("the clock tree", async () => {
  await E(page, "openClockTree('clock')");
  matchesGolden("clock-tree.svg", await svgOf("ctSvg"));
});

test("the reset tree", async () => {
  await E(page, "openClockTree('reset')");
  matchesGolden("reset-tree.svg", await svgOf("ctSvg"));
  await E(page, "closeClockTree()");
});

test("a subsystem's sheet (Control)", async () => {
  await E(page, "openSheet('Control')");
  matchesGolden("sheet-control.svg", await svgOf("canvas"));
});
