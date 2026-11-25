// HA 2 run headlessly for tests: a real `ha serve` on a scratch copy of a
// model, and the real page in jsdom. Tests drive the page through its own
// functions (the ones a click or a menu item calls) and read the saved files.
//
// `ha` must be on PATH (the venv), or set HA_CMD.
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

export const HERE = dirname(fileURLToPath(import.meta.url));
// A frozen copy of the Wi-Fi example: the user keeps editing examples/, the
// tests must not change when they do.
export const FIXTURE = join(HERE, "fixtures", "wifi_router");
export const TOP = "WifiPacketRouterFpga";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pages = new Set(); // closed before the server stops, so no request is left hanging

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
  const stop = () => {
    for (const w of pages) w.close();
    pages.clear();
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
  stop();
  throw new Error(`ha serve did not start: ${stderr}`);
}

/** Open HA 2 on `sheet`; resolves once the model is loaded and drawn. */
export async function openPage(url, sheet = TOP) {
  const dom = await JSDOM.fromURL(`${url}#${sheet}`, {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = (u, o) => fetch(new URL(u, url), o);
      w.__alerts = [];
      w.alert = (m) => w.__alerts.push(String(m));
    },
  });
  const w = dom.window;
  pages.add(w);
  // every script loaded (the page's load event), and the model loaded and drawn
  await waitFor(
    () => w.document.readyState === "complete" && status(w) === "ready",
    "the page to load",
  );
  return w;
}

export function status(w) {
  const s = w.document.getElementById("status");
  return s ? s.textContent : "";
}

export async function waitFor(cond, what, ms = 5000) {
  for (let t = 0; t < ms; t += 50) {
    if (cond()) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Wait for HA 2's autosave of the last edit; fails if it was not saved. */
export async function saved(w) {
  await sleep(400); // the save is scheduled 350 ms after an edit
  await waitFor(() => !["unsaved", "saving…"].includes(status(w)), "the save");
  if (status(w) !== "saved") {
    const problems = w.document.getElementById("problems").textContent;
    throw new Error(`not saved: status "${status(w)}"; ${problems}`);
  }
}

/** Evaluate an expression inside the page (its functions and state). */
export const E = (w, expr) => w.eval(expr);

export function readModel(dir, file) {
  return JSON.parse(readFileSync(join(dir, file), "utf-8"));
}
