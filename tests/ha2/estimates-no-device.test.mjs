// Resource estimates in HA 2 on a model without a target device (the frozen
// Wi-Fi fixture, from before devices): the banner and the menu say so.
import assert from "node:assert/strict";
import { test } from "node:test";
import { E, TOP, openPage, startServer, waitFor } from "./harness.mjs";

test("a model without a target device says so", async () => {
  const plain = await startServer();
  try {
    const plainPage = await openPage(plain.url);
    await waitFor(
      async () =>
        (
          await E(
            plainPage,
            "document.getElementById('resourceBanner').innerText",
          )
        ).includes("no target device"),
      "no target device",
    );
    assert.match(
      await E(
        plainPage,
        `(compMenu({ clientX: 10, clientY: 10 }, '${TOP}', 'uart'), document.getElementById('menu').innerText)`,
      ),
      /Estimate: no target device/,
    );
    assert.deepEqual(plainPage.errors, []);
  } finally {
    await plain.stop();
  }
});
