// Which sheet HA 2 opens first (openFirstSheet in main.js).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { E, TOP, openPage, startServer } from "./harness.mjs";

let server;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server.stop();
});

test("the sheet named in the address", async () => {
  const page = await openPage(server.url, "Control");
  assert.equal(await E(page, "editor.sheet"), "Control");
});

test("no name, or a name that is not a sheet: the FPGA's sheet", async () => {
  for (const named of ["", "NoSuchSheet"]) {
    const page = await openPage(server.url, named);
    assert.equal(await E(page, "editor.sheet"), TOP, `#${named}`);
    assert.deepEqual(page.errors, []);
  }
});
