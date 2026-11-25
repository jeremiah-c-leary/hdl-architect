// HA 2: Clocks, resets, SYSREF: global nets, their pairing and checks.
import { G, S } from "./state.js";
import { askName, hint } from "./util.js";
import {
  endStr,
  ensureImport,
  parseEnd,
  partDef,
  partType,
  partsOf,
  pkgOf,
  portDef,
  portsOfDef,
  rebuildIndex,
  short,
  wiresOf,
} from "./model.js";
import { hasPortLayout, portLayout, sheetLayout } from "./layout.js";
import { mutate } from "./store.js";
import { setPortSide, uniquePortName } from "./edits.js";
import { menu, portMenu } from "./menus.js";
import { render } from "./render.js";

// ------------------------------------------------------------------ clocks, resets, SYSREF: global nets
// A port typed by one of these port defs is "global": it is shown as a tag in
// its net's colour, not as a wire. A net is still plain SysML: a sheet port
// bound to the block ports it feeds, or a block's output connected to them.
export const GLOBAL_DEFS = {
  ClockIn: ["clock", "in"],
  ClockOut: ["clock", "out"],
  ResetIn: ["reset", "in"],
  ResetOut: ["reset", "out"],
  SysrefIn: ["sysref", "in"],
  SysrefOut: ["sysref", "out"],
};
export const NET_COLORS = [
  "#1f77b4",
  "#d62728",
  "#2ca02c",
  "#9467bd",
  "#ff7f0e",
  "#17becf",
  "#8c564b",
  "#e377c2",
  "#bcbd22",
  "#7f7f7f",
];
export function portUsage(D, end) {
  return end.kind === "edge"
    ? portsOfDef(D).find((p) => p.name === end.port)
    : portsOfDef(partType(D, end.part)).find((p) => p.name === end.port);
}
export function globalInfo(D, end) {
  // {cat, source} or null; source as seen inside sheet D
  const u = portUsage(D, end);
  const g = u && u.type && GLOBAL_DEFS[short(u.type)];
  if (!g) return null;
  let dir = u.conjugated ? (g[1] === "in" ? "out" : "in") : g[1];
  return {
    cat: g[0],
    source: end.kind === "edge" ? dir === "in" : dir === "out",
  };
}
export function isGlobalWire(D, w) {
  const a = globalInfo(D, w.a),
    b = globalInfo(D, w.b);
  return !!(a && b && a.cat === b.cat);
}
export function drawnWires(D) {
  return wiresOf(D).wires.filter((w) => !isGlobalWire(D, w));
}
export function globalEnds(D) {
  const out = [];
  for (const p of portsOfDef(D)) {
    const e = { kind: "edge", port: p.name };
    if (globalInfo(D, e)) out.push(e);
  }
  for (const part of partsOf(D))
    for (const p of portsOfDef(short(part.type))) {
      const e = { kind: "part", part: part.name, port: p.name };
      if (globalInfo(D, e)) out.push(e);
    }
  return out;
}
export function netsOf(D) {
  // the global nets on sheet D, and which net each end is on
  const ends = globalEnds(D),
    parent = {};
  const find = (k) => (parent[k] === k ? k : (parent[k] = find(parent[k])));
  for (const e of ends) parent[endStr(e)] = endStr(e);
  for (const w of wiresOf(D).wires)
    if (isGlobalWire(D, w)) parent[find(endStr(w.a))] = find(endStr(w.b));
  const groups = {};
  for (const e of ends)
    (groups[find(endStr(e))] = groups[find(endStr(e))] || []).push(e);
  const nets = [];
  for (const members of Object.values(groups)) {
    const sources = members.filter((e) => globalInfo(D, e).source);
    if (members.length === 1 && !sources.length) continue; // a lone sink: unassigned
    const src = sources[0] || null;
    const cat = globalInfo(D, members[0]).cat;
    const u = src && portUsage(D, src);
    const f = u && u.redefines && u.redefines.frequency_hz;
    nets.push({
      name: src ? endStr(src) : `(no source: ${endStr(members[0])})`,
      cat,
      src,
      sources,
      members,
      freq: typeof f === "number" ? f : null,
    });
  }
  nets.sort(
    (a, b) =>
      (a.cat > b.cat) - (a.cat < b.cat) ||
      (a.name > b.name) - (a.name < b.name),
  );
  nets.forEach((n, i) => {
    n.color = NET_COLORS[i % NET_COLORS.length];
  });
  const byEnd = {};
  for (const n of nets) for (const m of n.members) byEnd[endStr(m)] = n;
  return { nets, byEnd };
}
export function fmtHz(f) {
  if (f === null || f === undefined) return "";
  return f >= 1e9
    ? `${+(f / 1e9).toFixed(3)} GHz`
    : f >= 1e6
      ? `${+(f / 1e6).toFixed(3)} MHz`
      : f >= 1e3
        ? `${+(f / 1e3).toFixed(3)} kHz`
        : `${f} Hz`;
}
// ---- pairing: a SYSREF or a synchronous reset is sampled by one of its block's clock ports
export function catOfUsage(u) {
  const g = u && u.type && GLOBAL_DEFS[short(u.type)];
  return g ? g[0] : null;
}
export function hasAttr(type, name) {
  // does the port def (or the one it mirrors) declare attribute `name`?
  let d = portDef(type);
  if (d && d.conjugateOf) d = portDef(d.conjugateOf);
  return !!(
    d && (d.attributes || []).some((a) => a.name === name && !a.direction)
  );
}
export function paramOf(type, name) {
  // the default of a port def's parameter
  let d = portDef(type);
  if (d && d.conjugateOf) d = portDef(d.conjugateOf);
  const a =
    d && (d.attributes || []).find((x) => x.name === name && !x.direction);
  return a ? a.default : undefined;
}
export function pairable(u) {
  return (
    !!u &&
    ["sysref", "reset"].includes(catOfUsage(u)) &&
    hasAttr(u.type, "clock_port")
  );
}
export function clockPortsOf(P) {
  return portsOfDef(P).filter((u) => catOfUsage(u) === "clock");
}
export function pairedClock(u) {
  return u && u.redefines && typeof u.redefines.clock_port === "string"
    ? u.redefines.clock_port
    : null;
}
export function needsPair(u) {
  // a SYSREF always; a reset only when synchronous
  if (!pairable(u)) return false;
  if (catOfUsage(u) === "sysref") return true;
  const sync =
    u.redefines && "synchronous" in u.redefines
      ? u.redefines.synchronous
      : paramOf(u.type, "synchronous");
  return sync === true;
}
export function pairWith(u, clock) {
  // a reset paired with a clock is synchronous; unpaired, asynchronous
  if (clock)
    u.redefines = Object.assign(u.redefines || {}, { clock_port: clock });
  else if (u.redefines) delete u.redefines.clock_port;
  if (catOfUsage(u) === "reset" && hasAttr(u.type, "synchronous"))
    u.redefines = Object.assign(u.redefines || {}, { synchronous: !!clock });
  if (u.redefines && !Object.keys(u.redefines).length) delete u.redefines;
}
export function setPairing(P, port, clock) {
  mutate(() =>
    pairWith(
      portsOfDef(P).find((x) => x.name === port),
      clock,
    ),
  );
}
export function isAsyncReset(u) {
  // a reset that is not synchronous to a clock
  if (catOfUsage(u) !== "reset") return false;
  const sync =
    u.redefines && "synchronous" in u.redefines
      ? u.redefines.synchronous
      : paramOf(u.type, "synchronous");
  return !pairedClock(u) || sync === false;
}
export function netTiming(D, n, byEnd) {
  // what a reset / SYSREF net is timed by: its source's clock, or 'async'
  if (n.cat === "clock" || !n.src) return null;
  const u = portUsage(D, n.src),
    pc = pairedClock(u);
  if (n.cat === "reset" && isAsyncReset(u)) return "async";
  if (!pc) return n.cat === "sysref" ? "(no clock)" : null;
  const ce =
    n.src.kind === "edge"
      ? { kind: "edge", port: pc }
      : { kind: "part", part: n.src.part, port: pc };
  return byEnd[endStr(ce)] ? "@" + byEnd[endStr(ce)].name : "@" + endStr(ce);
}
export function pairMenu(ev, P, port) {
  const u = portsOfDef(P).find((x) => x.name === port),
    cur = pairedClock(u);
  const items = [{ head: `${P}.${port} is sampled by` }];
  for (const c of clockPortsOf(P))
    items.push({
      label: (c.name === cur ? "✓ " : "") + c.name,
      act: () => setPairing(P, port, c.name),
    });
  if (items.length === 1)
    items.push({ head: `${P} has no clock port: add a clock input first.` });
  if (cur)
    items.push({
      label: "no clock (asynchronous)",
      act: () => setPairing(P, port, null),
    });
  menu(ev.clientX, ev.clientY, items);
}
export function assignNet(D, end, net) {
  mutate(() => assignNetRaw(D, end, net));
}
export function retypeAndAssign(D, end, net) {
  // a port of the wrong kind (a clock on a SYSREF net): change its type, then assign
  mutate(() => {
    const u = portUsage(D, end),
      t = clockDefFor(D, net.cat, "in");
    if (!t) throw new Error(`The model has no ${net.cat} input port def.`);
    const P = end.kind === "edge" ? D : partType(D, end.part);
    u.type = t.type;
    if (t.conjugated) u.conjugated = true;
    else delete u.conjugated;
    ensureImport(pkgOf(P), t.type);
    rebuildIndex();
    const clocks = clockPortsOf(P);
    if (
      catOfUsage(u) === "sysref" &&
      pairable(u) &&
      !pairedClock(u) &&
      clocks.length === 1
    )
      pairWith(u, clocks[0].name);
    assignNetRaw(D, end, net);
  });
}
export function assignNetRaw(D, end, net) {
  // put a sink on a net (or on none); the wire is a bind or a connect
  {
    const d = partDef(D),
      me = endStr(end);
    for (const k of ["connections", "bindings"]) {
      if (!d[k]) continue;
      d[k] = d[k].filter((c) => {
        if (!c.ends.includes(me)) return true;
        const a = parseEnd(D, c.ends[0]),
          b = parseEnd(D, c.ends[1]);
        return !(a && b && isGlobalWire(D, { a, b }));
      });
      if (!d[k].length) delete d[k];
    }
    if (!net) return;
    if (!net.src) throw new Error(`${net.name} has no source to connect to.`);
    if (net.src.kind === "edge" || end.kind === "edge")
      (d.bindings = d.bindings || []).push({
        ends: [
          endStr(net.src.kind === "edge" ? net.src : end),
          endStr(net.src.kind === "edge" ? end : net.src),
        ],
      });
    else
      (d.connections = d.connections || []).push({
        ends: [endStr(net.src), me],
      });
  }
}
export function setNetFrequency(D, net) {
  const u = portUsage(D, net.src);
  const mhz = prompt(
    `Frequency of ${net.name} in MHz`,
    net.freq ? String(net.freq / 1e6) : "",
  );
  if (mhz === null) return;
  const v = parseFloat(mhz);
  if (!(v > 0)) {
    alert("A positive number of MHz, please.");
    return;
  }
  mutate(() => {
    u.redefines = Object.assign(u.redefines || {}, { frequency_hz: v * 1e6 });
  });
}
export function netMenu(ev, D, end) {
  const info = globalInfo(D, end),
    { nets, byEnd } = netsOf(D),
    cur = byEnd[endStr(end)];
  const items = [
    {
      head: `${endStr(end)}: ${info.cat}${info.source ? " (drives a net)" : ""}`,
    },
  ];
  if (!info.source) {
    for (const n of nets.filter((n) => n.cat === info.cat && n.src))
      items.push({
        label:
          (cur === n ? "✓ " : "") +
          `on ${n.name}${n.freq ? "  " + fmtHz(n.freq) : ""}`,
        act: () => assignNet(D, end, n),
      });
    if (cur)
      items.push({ label: "on no net", act: () => assignNet(D, end, null) });
    const others = nets.filter((n) => n.cat !== info.cat && n.src);
    if (others.length)
      items.push({ head: `other kinds (the port's type changes)` });
    for (const n of others)
      items.push({
        label: `on ${n.name}: make it a ${n.cat} input`,
        act: () => retypeAndAssign(D, end, n),
      });
    if (items.length === 1)
      items.push({
        head: `No ${info.cat} source on this sheet yet: add one to the sheet edge or a block.`,
      });
  } else if (cur) {
    items.push({
      label: `Frequency${cur.freq ? " (" + fmtHz(cur.freq) + ")" : ""}…`,
      act: () => setNetFrequency(D, cur),
    });
    items.push({
      label: `Pick this net, then click ports to put them on it`,
      act: () => armNet(cur),
    });
  }
  const P = end.kind === "edge" ? D : partType(D, end.part),
    u = portUsage(D, end);
  if (pairable(u))
    items.push(
      { sep: true },
      {
        label: `Sampled by: ${pairedClock(u) || "(no clock)"}…`,
        act: () => pairMenu(ev, P, end.port),
      },
    );
  items.push(
    { sep: true },
    {
      label: "Port actions…",
      act: () => portMenu(ev, P, end.port, end.kind === "edge"),
    },
  );
  menu(ev.clientX, ev.clientY, items);
}
export function armNet(net) {
  S.armedNet = net ? net.name : null;
  render();
  hint(
    net
      ? `Click ${net.cat} ports to put them on ${net.name} (click one already on it to take it off). Esc stops.`
      : "",
  );
}
export function clockDefFor(D, cat, dir) {
  // the port def to use for a new clock/reset port, if the model has it
  const want = Object.keys(GLOBAL_DEFS).find(
    (n) => GLOBAL_DEFS[n][0] === cat && GLOBAL_DEFS[n][1] === dir,
  );
  if (portDef(want)) return { type: want };
  const other = Object.keys(GLOBAL_DEFS).find(
    (n) => GLOBAL_DEFS[n][0] === cat && GLOBAL_DEFS[n][1] !== dir,
  );
  if (portDef(other)) return { type: other, conjugated: true }; // e.g. FpgaLib has only ClockIn: ~ClockIn
  return null;
}
export function addGlobalPort(P, cat, dir, base, edgeSide) {
  const t = clockDefFor(P, cat, dir);
  if (!t) {
    alert(
      `The model has no ${cat} port def (${Object.keys(GLOBAL_DEFS)
        .filter((n) => GLOBAL_DEFS[n][0] === cat)
        .join(" / ")}).`,
    );
    return;
  }
  const name = askName(
    `New ${cat} ${dir === "in" ? "input" : "output"} of ${P}`,
    uniquePortName(P, base),
  );
  if (!name) return;
  if (portsOfDef(P).some((p) => p.name === name)) {
    alert(`${P} already has a port ${name}.`);
    return;
  }
  mutate(() => {
    const d = partDef(P);
    (d.ports = d.ports || []).push(Object.assign({ name }, t));
    ensureImport(pkgOf(P), t.type);
    rebuildIndex();
    if (edgeSide) {
      const sl = sheetLayout(P);
      const ys = Object.values(sl.edge).map((e) => e.y);
      sl.edge[name] = {
        side: edgeSide,
        y: (ys.length ? Math.max(...ys) : G.TOP) + G.PGAP,
      };
      setPortSide(P, name, edgeSide);
    } else addPortLayout(P, name, dir === "in" ? "left" : "right");
    const u = portsOfDef(P).find((x) => x.name === name),
      clocks = clockPortsOf(P);
    if (catOfUsage(u) === "sysref" && pairable(u) && clocks.length === 1)
      pairWith(u, clocks[0].name); // SYSREF: the only clock
  });
  const u = portsOfDef(P).find((x) => x.name === name);
  if (
    u &&
    catOfUsage(u) === "sysref" &&
    !pairedClock(u) &&
    clockPortsOf(P).length > 1
  )
    hint(
      `${P}.${name}: click it (or right-click it), "Sampled by…", to pick its device clock.`,
    );
  else if (u && catOfUsage(u) === "reset" && pairable(u))
    hint(
      `${P}.${name} is asynchronous. If it is synchronous to a clock, click it, "Sampled by…", and pick the clock.`,
    );
}
export function addPortLayout(P, name, side) {
  const l = portLayout(P, name);
  l.side = side;
  const offs = portsOfDef(P)
    .filter((q) => q.name !== name && hasPortLayout(P, q.name))
    .map((q) => portLayout(P, q.name))
    .filter((x) => x.side === side)
    .map((x) => x.offset);
  l.offset = offs.length ? Math.max(...offs) + G.PGAP : G.PMT;
}
