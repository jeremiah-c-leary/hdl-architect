// SVG export for documents: standalone, light theme, no editing marks.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { E, openPage, startServer } from "./harness.mjs";

let server, w;
before(async () => {
  server = await startServer();
  w = await openPage(server.url);
});
after(() => server.stop());

test("the export is a standalone light-theme SVG without editing marks", () => {
  E(w, "S.sel = { kind: 'part', name: 'adc_if' }; render()");
  const canvas = w.document.getElementById("canvas");
  assert.ok(canvas.querySelector(".sel"), "the selection is drawn on screen");
  const { text } = w.exportSvgText(canvas);
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
