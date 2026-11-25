// HA 2 run headlessly for tests: a real `ha serve` on a scratch copy of a
// model, and the real page in headless Chromium (Playwright). Tests drive the
// page through its own functions (the ones a click or a menu item calls) or
// through real input, and read the saved files.
//
// `ha` must be on PATH (the venv), or set HA_CMD. Chromium: `npx playwright
// install chromium` once.
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

export const HERE = dirname(fileURLToPath(import.meta.url));
// A frozen copy of the Wi-Fi example: the user keeps editing examples/, the
// tests must not change when they do.
export const FIXTURE = join(HERE, "fixtures", "wifi_router");
export const TOP = "WifiPacketRouterFpga";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser = null; // one Chromium per test file, closed by the last stop()
const pages = new Set();

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** Start `ha serve` on a scratch copy of `fixture`. Call stop() when done. */
export async function startServer(fixture = FIXTURE) {
  const dir = mkdtempSync(join(tmpdir(), "ha2-test-"));
  cpSync(fixture, dir, { recursive: true });
  const port = await freePort();
  const proc = spawn(
    process.env.HA_CMD || "ha",
    ["serve", "--path", dir, "--port", String(port)],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  proc.stderr.on("data", (d) => (stderr += d));
  const url = `http://127.0.0.1:${port}/`;
  const stop = async () => {
    for (const p of pages) await p.close();
    pages.clear();
    if (browser) await browser.close();
    browser = null;
    proc.kill();
    rmSync(dir, { recursive: true, force: true });
  };
  for (let i = 0; i < 150; i++) {
    try {
      await fetch(url + "api/check");
      return { url, dir, stop };
    } catch {
      await sleep(100);
    }
  }
  await stop();
  throw new Error(`ha serve did not start: ${stderr}`);
}

/** Open HA 2 on `sheet`; resolves once the model is loaded and drawn. */
export async function openPage(url, sheet = TOP) {
  browser = browser || (await chromium.launch());
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  pages.add(page);
  page.errors = []; // uncaught errors in the page: a test can require none
  page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.addInitScript(() => {
    // runs inside the page, where globalThis is window
    globalThis.__alerts = [];
    globalThis.alert = (m) => globalThis.__alerts.push(String(m));
  });
  await page.goto(`${url}#${sheet}`, { waitUntil: "load" });
  await waitFor(
    async () => (await status(page)) === "ready",
    "the page to load",
  );
  return page;
}

/**
 * Evaluate an expression in the page. Names are looked up in `window.ha2`
 * (what HA 2 exposes for tests and the console) and else in the page's
 * globals, so tests do not depend on how HA 2's code is split into files.
 * A promise is awaited.
 */
export function E(page, expr) {
  return page.evaluate(
    `(() => { with (window.ha2 || window) { return (${expr}); } })()`,
  );
}

export const status = (page) =>
  E(page, "document.getElementById('status').textContent");

export async function waitFor(cond, what, ms = 5000) {
  for (let t = 0; t < ms; t += 50) {
    if (await cond()) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Wait for HA 2's autosave of the last edit; fails if it was not saved. */
export async function saved(page) {
  await sleep(400); // the save is scheduled 350 ms after an edit
  await waitFor(
    async () => !["unsaved", "saving…"].includes(await status(page)),
    "the save",
  );
  const s = await status(page);
  if (s !== "saved") {
    const problems = await E(
      page,
      "document.getElementById('problems').textContent",
    );
    throw new Error(`not saved: status "${s}"; ${problems}`);
  }
}

export function readModel(dir, file) {
  return JSON.parse(readFileSync(join(dir, file), "utf-8"));
}
