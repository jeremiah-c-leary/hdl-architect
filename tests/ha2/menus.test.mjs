// The right-click menus: each opens with its entries, and the menus they lead
// to open too and stay open (the menus were split out of menus.js, and a
// menu opened from a menu no longer vanishes at once, 2026-11-27).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { E, TOP, openPage, startServer } from "./harness.mjs";

let server, page;

before(async () => {
  server = await startServer();
  page = await openPage(server.url);
});
after(async () => {
  assert.deepEqual(page.errors, [], "no errors in the page");
  await server.stop();
});

/** A right-click at (40, 40), as the menus are given it. */
const CLICK = "{ clientX: 40, clientY: 40, preventDefault() {} }";

async function menuText() {
  await page.waitForSelector("#menu:not([hidden])");
  return E(page, "document.getElementById('menu').innerText");
}

/** Click the menu entry that starts with `label`; it opens the next menu. */
async function choose(label) {
  await page.click(`#menu .mi:text-matches("^${label}")`);
}

test("a part's menu, and its Kind and Change definition menus", async () => {
  await E(page, `partMenu(${CLICK}, '${TOP}', 'temp_if')`);
  const text = await menuText();
  for (const entry of ["temp_if : ", "Open its sheet", "Add a port…", "Delete"])
    assert.ok(text.includes(entry), `${entry} in the menu`);
  await choose("Kind:");
  assert.match(await menuText(), /is a…/);
  await E(page, `partMenu(${CLICK}, '${TOP}', 'temp_if')`);
  await choose("Change definition");
  assert.match(await menuText(), /Type of temp_if/);
  await E(page, "hideMenu()");
});

test("a port's menu, and its Set interface menu", async () => {
  const def = await E(page, `partType('${TOP}', 'temp_if')`);
  const port = await E(page, `portsOfDef('${def}')[0].name`);
  await E(page, `partPortMenu(${CLICK}, '${def}', '${port}')`);
  const text = await menuText();
  for (const entry of [`${def}.${port}`, "Set interface", "Rename (VHDL name)"])
    assert.ok(text.includes(entry), `${entry} in the menu`);
  await choose("Set interface");
  assert.match(await menuText(), new RegExp(`Interface of ${port}`));
  await E(page, "hideMenu()");
});

test("an edge port's menu", async () => {
  await E(page, `edgePortMenu(${CLICK}, '${TOP}', 'sys_clock')`);
  assert.match(await menuText(), new RegExp(`${TOP}\\.sys_clock`));
  await E(page, "hideMenu()");
});

test("several picked ports have their own menu", async () => {
  await E(
    page,
    `(editor.picked = [{ P: '${TOP}', port: 'sys_clock', isEdge: true }, { P: '${TOP}', port: 'jesd_refclk', isEdge: true }], edgePortMenu(${CLICK}, '${TOP}', 'sys_clock'))`,
  );
  assert.match(await menuText(), /2 ports picked/);
  await choose("Set their interface");
  assert.match(await menuText(), /Interface of 2 ports/);
  await E(page, "(editor.picked = [], hideMenu())");
});

test("the sheet's edge and column menus, and the library menu", async () => {
  await E(page, `edgeMenu(${CLICK}, 'left')`);
  assert.match(await menuText(), /Add a port to .* \(left edge\)/);
  await E(page, `columnMenu(${CLICK}, 0)`);
  const text = await menuText();
  assert.match(text, /Column 1/);
  assert.match(text, /Remove this column/);
  await choose("Add an instance of a library part");
  assert.match(await menuText(), /Add an instance of/);
  await E(page, "hideMenu()");
});
