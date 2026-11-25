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
import { E, HERE, openPage, startServer, waitFor } from "./harness.mjs";

const GOLDEN = join(HERE, "golden");
let server, w;

before(async () => {
  server = await startServer();
  w = await openPage(server.url);
});
after(() => server.stop());

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

const svgOf = (id) => w.exportSvgText(w.document.getElementById(id)).text;

test("the top sheet", () => {
  matchesGolden("sheet-top.svg", svgOf("canvas"));
});

test("the problem list of the top sheet", () => {
  matchesGolden(
    "problems-top.txt",
    w.document.getElementById("problems").textContent + "\n",
  );
});

test("the clock tree", async () => {
  w.openClockTree("clock");
  await waitFor(
    () => !w.document.getElementById("clockTree").hidden,
    "the clock tree",
  );
  matchesGolden("clock-tree.svg", svgOf("ctSvg"));
});

test("the reset tree", async () => {
  w.openClockTree("reset");
  matchesGolden("reset-tree.svg", svgOf("ctSvg"));
  E(w, "closeClockTree()");
});

test("a subsystem's sheet (Control)", () => {
  E(w, "openSheet('Control')");
  matchesGolden("sheet-control.svg", svgOf("canvas"));
});
