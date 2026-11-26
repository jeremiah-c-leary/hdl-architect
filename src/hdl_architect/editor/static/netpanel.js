// HA 2: the side panel's Clocks and resets list: the open sheet's nets, each
// with its colour, frequency and timing; click one to put ports on it.
// Moved as it was from render.js (2026-11-26); not yet tidied (NOT_YET_CLEAN).
import { editor } from "./state.js";
import { $ } from "./svg.js";
import { endStr, partDef, partType } from "./model.js";
import {
  armNet,
  fmtHz,
  globalEnds,
  globalInfo,
  netTiming,
  netsOf,
  pairMenu,
  pairable,
  pairedClock,
  portUsage,
  setNetFrequency,
} from "./nets.js";

export function renderNets() {
  const box = $("nets");
  if (!box) return;
  box.innerHTML = "";
  const D = editor.sheet;
  if (!D || !partDef(D)) return;
  const { nets, byEnd } = netsOf(D);
  const div = (cls, text, parent) => {
    const d = document.createElement("div");
    d.className = cls;
    if (text !== undefined) d.textContent = text;
    (parent || box).appendChild(d);
    return d;
  };
  if (!nets.length && !globalEnds(D).length) {
    div(
      "hint-s",
      "No clock or reset ports on this sheet. Right-click a block or the edge: Add a clock input.",
    );
    return;
  }
  for (const n of nets) {
    const row = div("net" + (editor.armedNet === n.name ? " armed" : ""));
    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = n.color;
    row.appendChild(sw);
    const t = document.createElement("span");
    t.textContent = `${n.name}`;
    row.appendChild(t);
    const fq = document.createElement("span");
    fq.className = "freq";
    fq.textContent = n.freq
      ? fmtHz(n.freq)
      : n.cat === "clock"
        ? "set MHz"
        : n.cat;
    row.appendChild(fq);
    const timing = netTiming(D, n, byEnd); // from the source: what it is synchronous to, or async
    if (timing) t.textContent += `  ${timing}`;
    const srcU = n.src && portUsage(D, n.src);
    if (n.src && pairable(srcU) && (n.cat === "sysref" || !pairedClock(srcU))) {
      // pair the source from here
      const a = document.createElement("a");
      a.className = "pairlink";
      a.textContent = pairedClock(srcU)
        ? "change"
        : n.cat === "sysref"
          ? "pair with its clock"
          : "pair (if synchronous)";
      a.title = `Pick the clock port of ${n.src.kind === "edge" ? D : partType(D, n.src.part)} that ${endStr(n.src)} is sampled by`;
      a.onclick = (e) => {
        e.stopPropagation();
        pairMenu(
          e,
          n.src.kind === "edge" ? D : partType(D, n.src.part),
          n.src.port,
        );
      };
      row.appendChild(a);
    }
    row.title =
      `${n.cat}: ${n.members.length - 1} port(s) on it\nClick: pick it, then click ports to put them on it.` +
      (n.cat !== "reset" && n.src
        ? "\nDouble-click the frequency to change it."
        : "");
    row.onclick = () => armNet(editor.armedNet === n.name ? null : n);
    if (n.src)
      fq.ondblclick = (e) => {
        e.stopPropagation();
        setNetFrequency(D, n);
      };
    for (const m of n.members.filter((m) => !n.sources.includes(m)))
      div("net-m", endStr(m));
  }
  const loose = globalEnds(D).filter(
    (e) => !byEnd[endStr(e)] && !globalInfo(D, e).source,
  );
  if (loose.length) {
    div("group", "on no net");
    for (const e of loose)
      div("net-m loose", `${endStr(e)} (${globalInfo(D, e).cat})`);
  }
}
