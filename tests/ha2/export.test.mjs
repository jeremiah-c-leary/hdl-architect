// SVG export for documents: standalone, light theme, no editing marks.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { E, openPage, startServer } from "./harness.mjs";

let server, page;
before(async () => {
  server = await startServer();
  page = await openPage(server.url);
});
after(async () => {
  assert.deepEqual(page.errors, [], "no errors in the page");
  await server.stop();
});

test("the export is a standalone light-theme SVG without editing marks", async () => {
  await E(page, "(S.sel = { kind: 'part', name: 'adc_if' }, render())");
  assert.ok(
    await E(page, "!!document.querySelector('#canvas .sel')"),
    "the selection is drawn on screen",
  );
  const text = await E(
    page,
    "exportSvgText(document.getElementById('canvas')).text",
  );
  assert.match(text, /^<\?xml /);
  assert.match(text, /<style>/, "styles are inside the file");
  assert.doesNotMatch(text, /var\(--/, "no CSS variable left unresolved");
  assert.doesNotMatch(
    text,
    /class="[^"]*\b(sel|armed|picked|grip)\b/,
    "no editing marks",
  );
  assert.match(text, /fill="#f6f7f9"/, "the light theme's background");
});
