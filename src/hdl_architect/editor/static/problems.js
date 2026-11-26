// HA 2: the problem list under the canvas: what is wrong or worth a look on
// the open sheet (unwired ports, clock and reset nets, pairing, clock-domain
// crossings, interfaces across wires, wire ends that name nothing).
// Moved as it was from render.js (2026-11-26); not yet tidied (NOT_YET_CLEAN).
import { editor } from "./state.js";
import { $ } from "./svg.js";
import {
  brokenEnds,
  counterpart,
  endStr,
  partDef,
  partType,
  partsOf,
  portsOfDef,
  unqualifiedName,
  wiresOf,
} from "./model.js";
import {
  catOfUsage,
  drawnWires,
  globalEnds,
  globalInfo,
  isAsyncReset,
  needsPair,
  netTiming,
  netsOf,
  pairedClock,
  portUsage,
} from "./nets.js";
import { sheetLayout } from "./layout.js";

export function renderProblems() {
  const f = $("problems");
  f.innerHTML = "";
  const add = (cls, t) => {
    const d = document.createElement("div");
    d.className = "p " + cls;
    d.textContent = t;
    f.appendChild(d);
  };
  for (const p of editor.saveProblems) add("err", "not saved: " + p);
  for (const p of editor.serverProblems) add("err", p);
  if (editor.sheet && partDef(editor.sheet)) {
    const D = editor.sheet,
      { wires } = wiresOf(D),
      sl = sheetLayout(D);
    const used = new Set(wires.flatMap((w) => [w.a, w.b]).map(endStr));
    const isG = (e) => !!globalInfo(D, e);
    const freeEdge = (partDef(D).ports || [])
      .filter((p) => !used.has(p.name) && !isG({ kind: "edge", port: p.name }))
      .map((p) => p.name);
    if (freeEdge.length)
      add("warn", `${D}: sheet ports not wired inside: ${freeEdge.join(", ")}`);
    const freePorts = [],
      untyped = [];
    for (const part of partsOf(D))
      for (const port of portsOfDef(unqualifiedName(part.type))) {
        const e = { kind: "part", part: part.name, port: port.name };
        if (!used.has(endStr(e)) && !isG(e)) freePorts.push(endStr(e));
        if (!port.type) untyped.push(endStr(e));
      }
    if (freePorts.length)
      add("warn", `unconnected component ports: ${freePorts.join(", ")}`);
    // clocks and resets
    const { nets, byEnd } = netsOf(D);
    const noNet = globalEnds(D)
      .filter((e) => !byEnd[endStr(e)] && !globalInfo(D, e).source)
      .map(endStr);
    if (noNet.length)
      add("warn", `clock/reset ports on no net: ${noNet.join(", ")}`);
    const idle = globalEnds(D)
      .filter(
        (e) =>
          globalInfo(D, e).source &&
          (!byEnd[endStr(e)] || byEnd[endStr(e)].members.length < 2),
      )
      .map(endStr);
    if (idle.length)
      add(
        "info",
        `clock/reset sources that feed nothing here: ${idle.join(", ")}`,
      );
    // pairing: the named clock must exist and be a clock; SYSREF (and synchronous resets) need one
    const pairErr = [],
      pairMissing = [],
      P_of = (e) => (e.kind === "edge" ? D : partType(D, e.part));
    for (const e of globalEnds(D)) {
      const u = portUsage(D, e),
        pc = pairedClock(u);
      if (pc) {
        const c = portsOfDef(P_of(e)).find((x) => x.name === pc);
        if (!c)
          pairErr.push(
            `${endStr(e)} names clock ${pc}, which ${P_of(e)} does not have`,
          );
        else if (catOfUsage(c) !== "clock")
          pairErr.push(
            `${endStr(e)} is paired with ${pc}, which is not a clock port (${c.type || "untyped"})`,
          );
      } else if (needsPair(u)) pairMissing.push(endStr(e));
    }
    for (const t of pairErr) add("err", t);
    if (pairMissing.length)
      add(
        "warn",
        `SYSREF / synchronous reset ports with no sampling clock (click them: Sampled by…): ${pairMissing.join(", ")}`,
      );
    // a reset net: an asynchronous source must not feed synchronous inputs directly (synchronise it
    // first), and a synchronous source should feed inputs on its own clock net
    for (const n of nets.filter((n) => n.cat === "reset" && n.src)) {
      const timing = netTiming(D, n, byEnd);
      const sinks = n.members.filter(
        (m) =>
          !n.sources.includes(m) &&
          pairedClock(portUsage(D, m)) &&
          !isAsyncReset(portUsage(D, m)),
      );
      const clockNetOf = (m) => {
        const pc = pairedClock(portUsage(D, m));
        const ce =
          m.kind === "edge"
            ? { kind: "edge", port: pc }
            : { kind: "part", part: m.part, port: pc };
        return byEnd[endStr(ce)] ? byEnd[endStr(ce)].name : null;
      };
      if (timing === "async" && sinks.length)
        add(
          "warn",
          `asynchronous reset ${n.name} feeds synchronous reset inputs ${sinks.map(endStr).join(", ")}: put a reset synchroniser in between (or make those inputs asynchronous)`,
        );
      if (timing && timing.startsWith("@")) {
        const other = sinks.filter(
          (m) => clockNetOf(m) && "@" + clockNetOf(m) !== timing,
        );
        if (other.length)
          add(
            "warn",
            `reset ${n.name} is synchronous to ${timing.slice(1)} but feeds inputs on other clocks: ${other.map((m) => endStr(m) + " (" + clockNetOf(m) + ")").join(", ")}`,
          );
      }
    }
    // every port on one SYSREF net should be sampled by clocks from one clock net
    for (const n of nets.filter((n) => n.cat === "sysref")) {
      const clockNets = new Set();
      for (const m of n.members) {
        const pc = pairedClock(portUsage(D, m));
        if (!pc) continue;
        const ce =
          m.kind === "edge"
            ? { kind: "edge", port: pc }
            : { kind: "part", part: m.part, port: pc };
        clockNets.add(
          byEnd[endStr(ce)]
            ? byEnd[endStr(ce)].name
            : `${endStr(ce)} (on no net)`,
        );
      }
      if (clockNets.size > 1)
        add(
          "warn",
          `SYSREF ${n.name} is sampled by clocks from different nets: ${[...clockNets].join(", ")} (JESD204B subclass 1 needs one device-clock source)`,
        );
    }
    for (const n of nets)
      if (n.sources.length > 1)
        add(
          "err",
          `net ${n.name} has ${n.sources.length} sources: ${n.sources.map(endStr).join(", ")}`,
        );
    // a wire between two blocks that each run on one, different, clock: a clock-domain crossing
    const clockOf = (part) => {
      const cs = new Set(
        globalEnds(D)
          .filter(
            (e) =>
              e.kind === "part" &&
              e.part === part &&
              globalInfo(D, e).cat === "clock" &&
              byEnd[endStr(e)],
          )
          .map((e) => byEnd[endStr(e)].name),
      );
      return cs.size === 1 ? [...cs][0] : null;
    };
    const cdc = drawnWires(D).filter(
      (w) =>
        w.a.kind === "part" &&
        w.b.kind === "part" &&
        clockOf(w.a.part) &&
        clockOf(w.b.part) &&
        clockOf(w.a.part) !== clockOf(w.b.part),
    );
    if (cdc.length)
      add(
        "info",
        `clock-domain crossings: ${cdc.map((w) => `${endStr(w.a)} (${clockOf(w.a.part)}) – ${endStr(w.b)} (${clockOf(w.b.part)})`).join("; ")}`,
      );
    const same = wires.filter(
      (w) =>
        w.a.kind === "part" &&
        w.b.kind === "part" &&
        sl.parts[w.a.part] &&
        sl.parts[w.b.part] &&
        sl.parts[w.a.part].col === sl.parts[w.b.part].col,
    );
    if (same.length)
      add(
        "warn",
        `wires inside one column (not planar): ${same.map((w) => endStr(w.a) + "–" + endStr(w.b)).join(", ")}`,
      );
    // interfaces across wires: a connect joins the two roles of one interface, a bind the same one
    const roleErr = [];
    for (const w of drawnWires(D)) {
      const a = portUsage(D, w.a),
        b = portUsage(D, w.b);
      if (!a || !b || !a.type || !b.type) continue;
      const ta = unqualifiedName(a.type) + (a.conjugated ? "~" : ""),
        tb = unqualifiedName(b.type) + (b.conjugated ? "~" : "");
      const ok =
        w.kind === "bind"
          ? ta === tb
          : (counterpart(unqualifiedName(a.type)) === unqualifiedName(b.type) &&
              !a.conjugated &&
              !b.conjugated) ||
            (unqualifiedName(a.type) === unqualifiedName(b.type) &&
              !!a.conjugated !== !!b.conjugated);
      if (!ok)
        roleErr.push(
          `${endStr(w.a)} (${ta}) ${w.kind === "bind" ? "=" : "–"} ${endStr(w.b)} (${tb})`,
        );
    }
    if (roleErr.length)
      add(
        "err",
        `interfaces that do not match across a wire (a connect needs the two roles of one interface, a bind the same one): ${roleErr.join("; ")}`,
      );
    const broken = brokenEnds(D);
    if (broken.length)
      add("err", `${D}: wire ends that name nothing: ${broken.join(", ")}`);
    if (untyped.length)
      add(
        "info",
        `ports with no interface yet (fine while exploring): ${untyped.length}`,
      );
  }
  if (!f.children.length) add("info", "No problems.");
}
