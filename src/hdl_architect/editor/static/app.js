/* HA 2: an editor for the model's SysML-shaped JSON, with HA 1's planar
 * column / gutter layout.
 *
 * Model (saved to <package>.json, the source of truth):
 *   a sheet      = a part def with parts
 *   a component  = a part usage (its ports are its part def's ports)
 *   a wire       = `connect a.p to b.q` between components, or
 *                  `bind p = a.q` from the sheet's own (edge) port to a component
 * Layout (saved to <package>.layout.json, never model data):
 *   sheets[D] = { columns, parts: {part: {col, y, h}}, edge: {port: {side, y}} }
 *   ports[P]  = { port: {side, offset} }      (per part def: shared by its instances)
 */
"use strict";

const NAME_RE = /^[A-Za-z](_?[A-Za-z0-9])*$/;
const KIND_COLORS = {
  // HA 1's colours (typeDefaultBgColor), by what a part def specializes
  SystemPart: "#0B980B",
  FpgaPart: "#c96a61",
  Fpga: "#c96a61",
  HwPart: "#7c5cc4",
  Subsystem: "#6b7280",
  Container: "#6b7280",
  Rtl: "#2f8f57",
  VendorIp: "#c9822f",
  HardMacro: "#2f5aa8",
  RegisterFile: "#b8960c",
  FpgaComponent: "#8a8f98",
};
const CONTAINER_KINDS = new Set([
  "SystemPart",
  "FpgaPart",
  "Fpga",
  "Subsystem",
  "Container",
]);
const G = {
  COMP_W: 170,
  EDGE_W: 120,
  MIN_GUTTER: 60,
  TOP: 64,
  LEFT: 16,
  PMT: 50,
  PMB: 14,
  PGAP: 22,
  MINH: 70,
  CGAP: 24,
  PORT_W: 8,
  PORT_H: 12,
};
const COLLS = [
  "partDefs",
  "portDefs",
  "attributeDefs",
  "itemDefs",
  "metadataDefs",
  "actionDefs",
];

const S = {
  pkgs: [], // {file, model, layout}
  defs: {}, // name -> {pkg, coll, def}
  sheet: null,
  back: [],
  sel: null, // {kind:'part', name}
  armed: null, // an end: {kind:'edge', port} | {kind:'part', part, port}
  undo: [],
  redo: [],
  saved: {}, // file -> {m, l} texts last saved
  serverProblems: [],
  saveProblems: [],
  drag: null,
  picked: [], // ports picked with Shift+click: [{P, port}]
  band: null, // a Shift+drag along a sheet edge: {side, y0}
  armedNet: null, // a net picked in the Clocks panel: clicking ports puts them on it
};

// ------------------------------------------------------------------ utilities
const $ = (id) => document.getElementById(id);
const SVGNS = "http://www.w3.org/2000/svg";
function el(tag, attrs, parent, text) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
function tip(e, text) {
  el("title", {}, e, text);
  return e;
}
function pascal(s) {
  return s
    .split(/[_\W]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
}
function snake(s) {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}
function shown(port) {
  return port.label || port.name;
} // a port's readable name, else its identifier
function trunc(s, n) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
function hint(msg) {
  $("hint").textContent = msg || DEFAULT_HINT;
}
const DEFAULT_HINT =
  "Filled port: has an interface; hollow: none yet. Drag a component's bottom edge to resize. Click a component, Ctrl+click another: two ports and a wire. Click a port, then another port to wire them (or a component / the edge for a new port). Right-click anything for actions. Drag components between columns.";
function askName(question, def) {
  for (;;) {
    const v = prompt(question, def || "");
    if (v === null) return null;
    const t = v.trim();
    if (NAME_RE.test(t)) return t;
    alert(
      `"${t}" is not a legal name: a letter, then letters, digits and single underscores (it must also be a legal VHDL name).`,
    );
    def = t
      .replace(/[^A-Za-z0-9_]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
  }
}

// ------------------------------------------------------------------ model index and queries
function rebuildIndex() {
  S.defs = {};
  for (const pkg of S.pkgs)
    for (const coll of COLLS)
      for (const d of pkg.model.package[coll] || [])
        S.defs[d.name] = { pkg, coll, def: d };
}
const short = (n) => (n || "").split("::").pop();
function partDef(n) {
  const e = S.defs[short(n)];
  return e && e.coll === "partDefs" ? e.def : null;
}
function portDef(n) {
  const e = S.defs[short(n)];
  return e && e.coll === "portDefs" ? e.def : null;
}
function pkgOf(n) {
  const e = S.defs[short(n)];
  return e ? e.pkg : null;
}
function kindOf(n, seen = new Set()) {
  n = short(n);
  if (KIND_COLORS[n]) return n;
  if (seen.has(n)) return null;
  seen.add(n);
  const d = partDef(n);
  for (const s of (d && d.specializes) || []) {
    const k = kindOf(s, seen);
    if (k) return k;
  }
  return null;
}
function isSheet(n) {
  const d = partDef(n);
  return (
    !!d &&
    ((d.parts || []).length > 0 || CONTAINER_KINDS.has(kindOf(n))) &&
    !d.isAbstract
  );
}
function partsOf(D) {
  return partDef(D).parts || [];
}
function partType(D, part) {
  const p = partsOf(D).find((x) => x.name === part);
  return p ? short(p.type) : null;
}
function portsOfDef(P) {
  const d = partDef(P);
  return d ? d.ports || [] : [];
}
function counterpart(t) {
  if (!t) return undefined;
  const d = portDef(t);
  if (d && d.conjugateOf) return d.conjugateOf;
  for (const n in S.defs) {
    const e = S.defs[n];
    if (e.coll === "portDefs" && e.def.conjugateOf === short(t)) return n;
  }
  return t;
}
function visibleIn(pkg, n) {
  // is definition n usable in pkg without a new import?
  const e = S.defs[short(n)];
  if (!e) return true;
  if (e.pkg === pkg) return true;
  return (pkg.model.package.imports || []).some(
    (i) => i.name.replace(/::\*$/, "") === e.pkg.model.package.name,
  );
}
function ensureImport(pkg, n) {
  if (visibleIn(pkg, n)) return;
  const target = S.defs[short(n)].pkg.model.package.name;
  (pkg.model.package.imports = pkg.model.package.imports || []).push({
    name: target + "::*",
  });
}

// ------------------------------------------------------------------ wires on a sheet
function parseEnd(D, s) {
  // null: not drawable here (a deeper chain, or broken)
  const bits = s.split(".");
  if (bits.length === 1)
    return portsOfDef(D).some((p) => p.name === s)
      ? { kind: "edge", port: s }
      : null;
  if (bits.length !== 2) return null;
  const part = partsOf(D).find((p) => p.name === bits[0]);
  if (!part || !portsOfDef(short(part.type)).some((p) => p.name === bits[1]))
    return null;
  return { kind: "part", part: bits[0], port: bits[1] };
}
function brokenEnds(D) {
  // ends that name a part or port that does not exist
  const d = partDef(D),
    out = [];
  for (const c of [...(d.connections || []), ...(d.bindings || [])])
    for (const s of c.ends) {
      const bits = s.split(".");
      if (bits.length === 1 && !portsOfDef(D).some((p) => p.name === s))
        out.push(s);
      if (bits.length === 2) {
        const part = partsOf(D).find((p) => p.name === bits[0]);
        if (
          !part ||
          (partDef(short(part.type)) &&
            !portsOfDef(short(part.type)).some((p) => p.name === bits[1]))
        )
          out.push(s);
      }
    }
  return out;
}
function endStr(e) {
  return e.kind === "edge" ? e.port : `${e.part}.${e.port}`;
}
function wiresOf(D) {
  const d = partDef(D),
    out = [];
  let hidden = 0;
  (d.connections || []).forEach((c, i) => {
    const a = parseEnd(D, c.ends[0]),
      b = parseEnd(D, c.ends[1]);
    if (a && b) out.push({ kind: "connect", idx: i, a, b });
    else hidden++;
  });
  (d.bindings || []).forEach((c, i) => {
    const a = parseEnd(D, c.ends[0]),
      b = parseEnd(D, c.ends[1]);
    if (a && b) out.push({ kind: "bind", idx: i, a, b });
    else hidden++;
  });
  return { wires: out, hidden };
}

// ------------------------------------------------------------------ clocks, resets, SYSREF: global nets
// A port typed by one of these port defs is "global": it is shown as a tag in
// its net's colour, not as a wire. A net is still plain SysML: a sheet port
// bound to the block ports it feeds, or a block's output connected to them.
const GLOBAL_DEFS = {
  ClockIn: ["clock", "in"],
  ClockOut: ["clock", "out"],
  ResetIn: ["reset", "in"],
  ResetOut: ["reset", "out"],
  SysrefIn: ["sysref", "in"],
  SysrefOut: ["sysref", "out"],
};
const NET_COLORS = [
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
function portUsage(D, end) {
  return end.kind === "edge"
    ? portsOfDef(D).find((p) => p.name === end.port)
    : portsOfDef(partType(D, end.part)).find((p) => p.name === end.port);
}
function globalInfo(D, end) {
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
function isGlobalWire(D, w) {
  const a = globalInfo(D, w.a),
    b = globalInfo(D, w.b);
  return !!(a && b && a.cat === b.cat);
}
function drawnWires(D) {
  return wiresOf(D).wires.filter((w) => !isGlobalWire(D, w));
}
function globalEnds(D) {
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
function netsOf(D) {
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
function fmtHz(f) {
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
function catOfUsage(u) {
  const g = u && u.type && GLOBAL_DEFS[short(u.type)];
  return g ? g[0] : null;
}
function hasAttr(type, name) {
  // does the port def (or the one it mirrors) declare attribute `name`?
  let d = portDef(type);
  if (d && d.conjugateOf) d = portDef(d.conjugateOf);
  return !!(
    d && (d.attributes || []).some((a) => a.name === name && !a.direction)
  );
}
function paramOf(type, name) {
  // the default of a port def's parameter
  let d = portDef(type);
  if (d && d.conjugateOf) d = portDef(d.conjugateOf);
  const a =
    d && (d.attributes || []).find((x) => x.name === name && !x.direction);
  return a ? a.default : undefined;
}
function pairable(u) {
  return (
    !!u &&
    ["sysref", "reset"].includes(catOfUsage(u)) &&
    hasAttr(u.type, "clock_port")
  );
}
function clockPortsOf(P) {
  return portsOfDef(P).filter((u) => catOfUsage(u) === "clock");
}
function pairedClock(u) {
  return u && u.redefines && typeof u.redefines.clock_port === "string"
    ? u.redefines.clock_port
    : null;
}
function needsPair(u) {
  // a SYSREF always; a reset only when synchronous
  if (!pairable(u)) return false;
  if (catOfUsage(u) === "sysref") return true;
  const sync =
    u.redefines && "synchronous" in u.redefines
      ? u.redefines.synchronous
      : paramOf(u.type, "synchronous");
  return sync === true;
}
function pairWith(u, clock) {
  // a reset paired with a clock is synchronous; unpaired, asynchronous
  if (clock)
    u.redefines = Object.assign(u.redefines || {}, { clock_port: clock });
  else if (u.redefines) delete u.redefines.clock_port;
  if (catOfUsage(u) === "reset" && hasAttr(u.type, "synchronous"))
    u.redefines = Object.assign(u.redefines || {}, { synchronous: !!clock });
  if (u.redefines && !Object.keys(u.redefines).length) delete u.redefines;
}
function setPairing(P, port, clock) {
  mutate(() =>
    pairWith(
      portsOfDef(P).find((x) => x.name === port),
      clock,
    ),
  );
}
function isAsyncReset(u) {
  // a reset that is not synchronous to a clock
  if (catOfUsage(u) !== "reset") return false;
  const sync =
    u.redefines && "synchronous" in u.redefines
      ? u.redefines.synchronous
      : paramOf(u.type, "synchronous");
  return !pairedClock(u) || sync === false;
}
function netTiming(D, n, byEnd) {
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
function pairMenu(ev, P, port) {
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
function assignNet(D, end, net) {
  mutate(() => assignNetRaw(D, end, net));
}
function retypeAndAssign(D, end, net) {
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
function assignNetRaw(D, end, net) {
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
function setNetFrequency(D, net) {
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
function netMenu(ev, D, end) {
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
function armNet(net) {
  S.armedNet = net ? net.name : null;
  render();
  hint(
    net
      ? `Click ${net.cat} ports to put them on ${net.name} (click one already on it to take it off). Esc stops.`
      : "",
  );
}
function clockDefFor(D, cat, dir) {
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
function addGlobalPort(P, cat, dir, base, edgeSide) {
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
function addPortLayout(P, name, side) {
  const l = portLayout(P, name);
  l.side = side;
  const offs = portsOfDef(P)
    .filter((q) => q.name !== name && hasPortLayout(P, q.name))
    .map((q) => portLayout(P, q.name))
    .filter((x) => x.side === side)
    .map((x) => x.offset);
  l.offset = offs.length ? Math.max(...offs) + G.PGAP : G.PMT;
}

// ------------------------------------------------------------------ layout
function layoutOf(pkg) {
  if (!pkg.layout) pkg.layout = { layoutVersion: 1, sheets: {}, ports: {} };
  pkg.layout.sheets = pkg.layout.sheets || {};
  pkg.layout.ports = pkg.layout.ports || {};
  return pkg.layout;
}
function sheetLayout(D) {
  const L = layoutOf(pkgOf(D));
  return L.sheets[D] || (L.sheets[D] = { columns: 0, parts: {}, edge: {} });
}
function portLayout(P, port) {
  const L = layoutOf(pkgOf(P));
  const m = L.ports[P] || (L.ports[P] = {});
  return m[port] || (m[port] = { side: "left", offset: G.PMT });
}
function hasPortLayout(P, port) {
  const L = layoutOf(pkgOf(P));
  return !!(L.ports[P] && L.ports[P][port]);
}

function ensureLayout(D) {
  const sl = sheetLayout(D);
  const parts = partsOf(D);
  const { wires } = wiresOf(D);
  const nbr = {};
  for (const w of wires)
    if (w.a.kind === "part" && w.b.kind === "part") {
      (nbr[w.a.part] = nbr[w.a.part] || new Set()).add(w.b.part);
      (nbr[w.b.part] = nbr[w.b.part] || new Set()).add(w.a.part);
    }
  // drop layout of things that no longer exist
  for (const k of Object.keys(sl.parts))
    if (!parts.some((p) => p.name === k)) delete sl.parts[k];
  for (const k of Object.keys(sl.edge))
    if (!portsOfDef(D).some((p) => p.name === k)) delete sl.edge[k];
  // place new parts: the lowest column holding none of their neighbours
  for (const p of parts) {
    if (sl.parts[p.name]) continue;
    const taken = new Set(
      [...(nbr[p.name] || [])]
        .filter((n) => sl.parts[n])
        .map((n) => sl.parts[n].col),
    );
    let col = 0;
    while (taken.has(col)) col++;
    const bottom = Math.max(
      G.TOP,
      ...Object.values(sl.parts)
        .filter((q) => q.col === col)
        .map((q) => q.y + q.h),
    );
    sl.parts[p.name] = { col, y: bottom + G.CGAP, h: G.MINH };
  }
  const used = Math.max(0, ...Object.values(sl.parts).map((q) => q.col + 1));
  sl.columns = Math.max(sl.columns || 0, used, parts.length ? 1 : 3);
  // edge ports: the side of the part they bind to
  const sideCount = { left: 0, right: 0 };
  for (const p of portsOfDef(D)) {
    if (sl.edge[p.name]) continue;
    const w = wires.find(
      (w) =>
        (w.a.kind === "edge" && w.a.port === p.name) ||
        (w.b.kind === "edge" && w.b.port === p.name),
    );
    const other = w ? (w.a.kind === "edge" ? w.b : w.a) : null;
    const side =
      other &&
      other.kind === "part" &&
      sl.parts[other.part] &&
      sl.parts[other.part].col >= sl.columns / 2
        ? "right"
        : "left";
    const ys = Object.values(sl.edge)
      .filter((e) => e.side === side)
      .map((e) => e.y);
    sl.edge[p.name] = {
      side,
      y:
        (ys.length ? Math.max(...ys) : G.TOP) +
        G.PGAP +
        (sideCount[side]++ ? 0 : 0),
    };
  }
  // ports of each component's def: face their peer
  for (const p of parts) {
    const P = short(p.type);
    if (!partDef(P)) continue;
    for (const port of portsOfDef(P)) {
      if (hasPortLayout(P, port.name)) continue;
      const w = wires.find((w) =>
        [w.a, w.b].some(
          (e) => e.kind === "part" && e.part === p.name && e.port === port.name,
        ),
      );
      let side = "left";
      if (w) {
        const me =
          w.a.kind === "part" && w.a.part === p.name && w.a.port === port.name
            ? w.a
            : w.b;
        const other = me === w.a ? w.b : w.a;
        if (other.kind === "edge")
          side = sl.edge[other.port] ? sl.edge[other.port].side : "left";
        else if (sl.parts[other.part])
          side =
            sl.parts[other.part].col > sl.parts[p.name].col ? "right" : "left";
      }
      const offs = portsOfDef(P)
        .filter((q) => q.name !== port.name && hasPortLayout(P, q.name))
        .map((q) => portLayout(P, q.name))
        .filter((l) => l.side === side)
        .map((l) => l.offset);
      const pl = portLayout(P, port.name);
      pl.side = side;
      pl.offset = offs.length ? Math.max(...offs) + G.PGAP : G.PMT;
    }
  }
}

function fitHeights(D) {
  // Keep ports apart and clear of the title. Ports with a drawn wire on this
  // sheet keep their height (pushed down only by each other); the rest (no
  // wire, or a clock/reset, which has no wire) move into the free slots.
  const sl = sheetLayout(D);
  const wired = new Set(
    drawnWires(D)
      .flatMap((w) => [w.a, w.b])
      .filter((e) => e.kind === "part")
      .map(endStr),
  );
  for (const p of partsOf(D)) {
    const P = short(p.type),
      q = sl.parts[p.name];
    if (!q) continue;
    let need = G.MINH;
    if (partDef(P))
      for (const side of ["left", "right"]) {
        const ports = portsOfDef(P).filter(
          (x) => portLayout(P, x.name).side === side,
        );
        const fixed = ports
          .filter((x) => wired.has(`${p.name}.${x.name}`))
          .map((x) => portLayout(P, x.name))
          .sort((a, b) => a.offset - b.offset);
        const taken = [];
        for (const l of fixed) {
          if (l.offset < G.PMT) l.offset = G.PMT;
          if (taken.length && l.offset < taken[taken.length - 1] + G.PGAP)
            l.offset = taken[taken.length - 1] + G.PGAP;
          taken.push(l.offset);
        }
        for (const l of ports
          .filter((x) => !wired.has(`${p.name}.${x.name}`))
          .map((x) => portLayout(P, x.name))
          .sort((a, b) => a.offset - b.offset)) {
          let o = Math.max(G.PMT, l.offset);
          while (taken.some((t) => Math.abs(t - o) < G.PGAP)) o += 2;
          l.offset = o;
          taken.push(o);
        }
        if (taken.length) need = Math.max(need, Math.max(...taken) + G.PMB);
      }
    if (q.h < need) q.h = need;
  }
}
function resolveOverlaps(D, componentsOnly) {
  const sl = sheetLayout(D);
  for (let c = 0; c < sl.columns; c++) {
    const col = Object.values(sl.parts)
      .filter((q) => q.col === c)
      .sort((a, b) => a.y - b.y);
    let bottom = G.TOP - G.CGAP + 10;
    for (const q of col) {
      if (q.y < bottom + G.CGAP) q.y = bottom + G.CGAP;
      bottom = q.y + q.h;
    }
  }
  if (componentsOnly) return;
  // sheet ports: wired ones keep their height (they follow their partner); the
  // others move into the nearest free slot below where they are
  const wired = new Set(
    drawnWires(D)
      .flatMap((w) => [w.a, w.b])
      .filter((e) => e.kind === "edge")
      .map((e) => e.port),
  );
  for (const side of ["left", "right"]) {
    const names = Object.keys(sl.edge).filter((n) => sl.edge[n].side === side);
    const fixed = names
      .filter((n) => wired.has(n))
      .sort((a, b) => sl.edge[a].y - sl.edge[b].y);
    const taken = [];
    for (const n of fixed) {
      // two wired ports too close: push the lower one
      const e = sl.edge[n];
      if (taken.length && e.y < taken[taken.length - 1] + G.PGAP)
        e.y = taken[taken.length - 1] + G.PGAP;
      taken.push(e.y);
    }
    for (const n of names
      .filter((n) => !wired.has(n))
      .sort((a, b) => sl.edge[a].y - sl.edge[b].y)) {
      const e = sl.edge[n];
      let y = Math.max(G.TOP + 10, e.y);
      while (taken.some((t) => Math.abs(t - y) < G.PGAP)) y += 2;
      e.y = y;
      taken.push(y);
    }
  }
}
function setAbsY(D, end, y) {
  const sl = sheetLayout(D);
  if (end.kind === "edge") {
    sl.edge[end.port].y = Math.max(G.TOP + 10, y);
    return;
  }
  const q = sl.parts[end.part],
    P = partType(D, end.part);
  const l = portLayout(P, end.port);
  let off = y - q.y;
  if (off < G.PMT) {
    q.y = y - G.PMT;
    off = G.PMT;
  }
  if (off > q.h - G.PMB) q.h = off + G.PMB;
  l.offset = off;
}
function settle(D) {
  ensureLayout(D);
  // Every wire is drawn straight: between components, the left end sets the
  // height and the right end follows; a sheet port (cheap to move) always
  // follows the component port it is bound to.
  for (let pass = 0; pass < 8; pass++) {
    fitHeights(D);
    resolveOverlaps(D, true);
    const geo = geometry(D);
    const ws = drawnWires(D)
      .map((w) => {
        const A = absPort(D, geo, w.a),
          B = absPort(D, geo, w.b);
        if (!A || !B) return null;
        if (w.a.kind === "edge") return [B, w.a]; // [anchor, follower]
        if (w.b.kind === "edge") return [A, w.b];
        return A.x <= B.x ? [A, w.b] : [B, w.a];
      })
      .filter(Boolean)
      .sort(
        (p, q) =>
          (p[1].kind === "edge") - (q[1].kind === "edge") ||
          p[0].x - q[0].x ||
          p[0].y - q[0].y,
      );
    let moved = false;
    for (const [L, r] of ws) {
      const g = geometry(D),
        Ly = absPort(D, g, L.end).y,
        Ry = absPort(D, g, r).y;
      if (Math.abs(Ly - Ry) > 0.5) {
        setAbsY(D, r, Ly);
        moved = true;
      }
    }
    if (!moved) break;
  }
  fitHeights(D);
  resolveOverlaps(D, false);
}

// ------------------------------------------------------------------ geometry
function geometry(D) {
  const sl = sheetLayout(D);
  const build = (gw) => {
    let x = G.LEFT;
    const edgeL = { x0: x, x1: x + G.EDGE_W };
    x += G.EDGE_W;
    const cols = [],
      gutters = [];
    for (let i = 0; i < sl.columns; i++) {
      gutters.push({ x0: x, x1: x + gw[i] });
      x += gw[i];
      cols.push({ x0: x, x1: x + G.COMP_W });
      x += G.COMP_W;
    }
    gutters.push({ x0: x, x1: x + gw[sl.columns] });
    x += gw[sl.columns];
    const edgeR = { x0: x, x1: x + G.EDGE_W };
    x += G.EDGE_W;
    return { edgeL, edgeR, cols, gutters, width: x + G.LEFT };
  };
  let geo = build(new Array(sl.columns + 1).fill(G.MIN_GUTTER));
  const counts = new Array(sl.columns + 1).fill(0);
  for (const w of drawnWires(D)) {
    const A = absPort(D, geo, w.a),
      B = absPort(D, geo, w.b);
    if (!A || !B) continue;
    const lo = Math.min(A.x, B.x),
      hi = Math.max(A.x, B.x);
    geo.gutters.forEach((g, i) => {
      if (hi > g.x0 && lo < g.x1) counts[i]++;
    });
  }
  return build(counts.map((c) => Math.min(260, G.MIN_GUTTER + c * 12)));
}
function absPort(D, geo, end) {
  const sl = sheetLayout(D);
  if (end.kind === "edge") {
    const e = sl.edge[end.port];
    if (!e) return null;
    return {
      x: e.side === "left" ? geo.edgeL.x1 : geo.edgeR.x0,
      y: e.y,
      side: e.side === "left" ? "right" : "left",
      end,
    };
  }
  const q = sl.parts[end.part];
  const P = partType(D, end.part);
  if (!q || !P || !partDef(P) || !geo.cols[q.col]) return null;
  const l = portLayout(P, end.port);
  const col = geo.cols[q.col];
  return {
    x: l.side === "left" ? col.x0 : col.x1,
    y: q.y + l.offset,
    side: l.side,
    end,
  };
}
function columnAt(geo, x) {
  let best = 0,
    bd = Infinity;
  geo.cols.forEach((c, i) => {
    const d = Math.abs(x - (c.x0 + c.x1) / 2);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

// ------------------------------------------------------------------ change, undo, save
function snapshot() {
  return JSON.stringify(S.pkgs.map((p) => [p.model, p.layout || null]));
}
function restore(snap) {
  JSON.parse(snap).forEach(([m, l], i) => {
    S.pkgs[i].model = m;
    S.pkgs[i].layout = l;
  });
}
function mutate(fn) {
  const snap = snapshot();
  let ok;
  try {
    ok = fn();
  } catch (err) {
    restore(snap);
    rebuildIndex();
    alert(err.message);
    return;
  }
  if (ok === false) {
    restore(snap);
    rebuildIndex();
    render();
    return;
  }
  S.undo.push(snap);
  if (S.undo.length > 200) S.undo.shift();
  S.redo = [];
  changed();
}
function changed() {
  rebuildIndex();
  repairImports();
  if (S.sheet && partDef(S.sheet)) settle(S.sheet);
  render();
  scheduleSave();
}
function repairImports() {
  // every definition a package refers to must be visible in it: add missing imports
  for (const pkg of S.pkgs)
    for (const coll of COLLS)
      for (const d of pkg.model.package[coll] || []) {
        const refs = [
          ...(d.specializes || []),
          d.conjugateOf,
          ...[
            ...(d.parts || []),
            ...(d.ports || []),
            ...(d.attributes || []),
            ...(d.items || []),
            ...(d.parameters || []),
            ...(d.performs || []),
            ...(d.metadata || []),
          ].map((u) => u.type),
        ];
        for (const r of refs) if (r && S.defs[short(r)]) ensureImport(pkg, r);
      }
}
function undo() {
  if (!S.undo.length) return;
  S.redo.push(snapshot());
  restore(S.undo.pop());
  changed();
}
function redo() {
  if (!S.redo.length) return;
  S.undo.push(snapshot());
  restore(S.redo.pop());
  changed();
}

let saveTimer = null,
  checkTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveAll, 350);
  setStatus("unsaved");
}
async function put(url, body) {
  const r = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await r.json();
}
async function saveAll() {
  setStatus("saving…");
  const problems = [];
  for (const p of S.pkgs) {
    const m = JSON.stringify(p.model),
      l = JSON.stringify(p.layout || null);
    const last = S.saved[p.file] || {};
    if (m !== last.m) {
      const res = await put("/api/file", {
        file: p.file,
        model: p.model,
        base: p.version,
      });
      const errs = res.errors || [];
      if (errs.length) problems.push(...errs.map((e) => `${p.file}: ${e}`));
      else {
        last.m = m;
        p.version = res.version;
      }
      if (res.stale) S.stale = true;
    }
    if (p.layout && l !== last.l) {
      const res = await put("/api/layout", {
        file: p.file,
        layout: p.layout,
        base: p.layoutVersion,
      });
      const errs = res.errors || [];
      if (errs.length)
        problems.push(...errs.map((e) => `${p.file} (layout): ${e}`));
      else {
        last.l = l;
        p.layoutVersion = res.version;
      }
      if (res.stale) S.stale = true;
    }
    S.saved[p.file] = last;
  }
  S.saveProblems = problems;
  setStatus(
    S.stale
      ? "changed on disk: reload"
      : problems.length
        ? "not saved"
        : "saved",
    !!problems.length,
  );
  renderProblems();
  clearTimeout(checkTimer);
  checkTimer = setTimeout(check, 400);
}
async function check() {
  const r = await fetch("/api/check");
  S.serverProblems = (await r.json()).errors || [];
  renderProblems();
}
function setStatus(t, err) {
  const s = $("status");
  s.textContent = t;
  s.className = err ? "err" : "";
}

// ------------------------------------------------------------------ edits
function uniquePortName(P, base) {
  const names = new Set(portsOfDef(P).map((p) => p.name));
  let n = base,
    i = 2;
  while (names.has(n)) n = `${base}_${i++}`;
  return n;
}
function uniqueDefName(base) {
  let n = base,
    i = 2;
  while (S.defs[n]) n = `${base}${i++}`;
  return n;
}
function uniquePartName(D, base) {
  const names = new Set(partsOf(D).map((p) => p.name));
  let n = base,
    i = 2;
  while (names.has(n)) n = `${base}_${i++}`;
  return n;
}
function addPort(P, name, type, side, offset) {
  const d = partDef(P);
  (d.ports = d.ports || []).push(type ? { name, type } : { name });
  rebuildIndex();
  const l = portLayout(P, name);
  l.side = side;
  const offs = portsOfDef(P)
    .filter((q) => q.name !== name && hasPortLayout(P, q.name))
    .map((q) => portLayout(P, q.name))
    .filter((x) => x.side === side)
    .map((x) => x.offset);
  l.offset =
    offset !== undefined
      ? offset
      : offs.length
        ? Math.max(...offs) + G.PGAP
        : G.PMT;
}
function quickConnect(a, b) {
  const D = S.sheet,
    sl = sheetLayout(D);
  if (sl.parts[a].col === sl.parts[b].col) {
    hint(
      `${a} and ${b} are in the same column: there is no gutter for a horizontal wire (maybe a level of hierarchy is missing). Move one to another column.`,
    );
    return;
  }
  mutate(() => {
    const A = partType(D, a),
      B = partType(D, b);
    const aLeft = sl.parts[a].col < sl.parts[b].col;
    const pa = uniquePortName(A, b);
    addPort(A, pa, undefined, aLeft ? "right" : "left");
    const pb = uniquePortName(B, a);
    addPort(B, pb, undefined, aLeft ? "left" : "right");
    const d = partDef(D);
    (d.connections = d.connections || []).push({
      ends: [`${a}.${pa}`, `${b}.${pb}`],
    });
  });
  hint(`Connected ${a} and ${b}. Right-click a port to give it an interface.`);
}
function connectArmed(target) {
  // target: a part name on this sheet, or {edge:'left'|'right'}
  const D = S.sheet,
    sl = sheetLayout(D),
    armed = S.armed;
  S.armed = null;
  const armedPort =
    armed.kind === "edge"
      ? portsOfDef(D).find((p) => p.name === armed.port)
      : portsOfDef(partType(D, armed.part)).find((p) => p.name === armed.port);
  if (!armedPort) {
    render();
    return;
  }
  const armedType = armedPort.type;
  mutate(() => {
    const d = partDef(D);
    if (target.edge) {
      if (armed.kind !== "part") return false;
      const name = uniquePortName(D, armed.port);
      (d.ports = d.ports || []).push(
        armedType ? { name, type: armedType } : { name },
      );
      rebuildIndex();
      const ys = Object.values(sl.edge)
        .filter((e) => e.side === target.edge)
        .map((e) => e.y);
      sl.edge[name] = {
        side: target.edge,
        y: target.y || (ys.length ? Math.max(...ys) + G.PGAP : G.TOP + G.PGAP),
      };
      (d.bindings = d.bindings || []).push({
        ends: [name, `${armed.part}.${armed.port}`],
      });
      return;
    }
    const part = target.part,
      P = partType(D, part);
    if (armed.kind === "part" && armed.part === part) return false;
    if (armed.kind === "edge") {
      // the sheet port moves to the edge nearer the component, so the wire need not cross the sheet
      const side = sl.parts[part].col >= sl.columns / 2 ? "right" : "left";
      sl.edge[armed.port].side = side;
      const name = uniquePortName(P, armed.port);
      addPort(P, name, armedType, side);
      (d.bindings = d.bindings || []).push({
        ends: [armed.port, `${part}.${name}`],
      });
    } else {
      if (sl.parts[armed.part].col === sl.parts[part].col) {
        hint("Same column: move one of them first.");
        return false;
      }
      const aLeft = sl.parts[armed.part].col < sl.parts[part].col;
      const name = uniquePortName(P, armed.part);
      addPort(P, name, counterpart(armedType), aLeft ? "left" : "right");
      (d.connections = d.connections || []).push({
        ends: [`${armed.part}.${armed.port}`, `${part}.${name}`],
      });
    }
  });
}
// Wire two ports that already exist: click one, then the other. Two component
// ports make a connect (the two roles of one interface); a sheet port and a
// component port make a bind (the same interface). An untyped end takes the
// matching interface from the other; ports facing away are turned to face
// each other when they have no other wire.
function interfacesFit(ua, ub, isBind) {
  const ta = short(ua.type),
    tb = short(ub.type);
  if (isBind) return ta === tb && !!ua.conjugated === !!ub.conjugated;
  return (
    (counterpart(ta) === tb && !ua.conjugated && !ub.conjugated) ||
    (ta === tb && !!ua.conjugated !== !!ub.conjugated)
  );
}
function connectPorts(a, b) {
  const D = S.sheet,
    sl = sheetLayout(D);
  S.armed = null;
  const say = (msg) => {
    render();
    hint(msg);
  };
  if (a.kind === "edge" && b.kind === "edge")
    return say(
      "Two sheet ports cannot be wired to each other: wire each to a component.",
    );
  if (a.kind === "part" && b.kind === "part" && a.part === b.part)
    return say(
      `Both ports are on ${a.part}: wire ports of two different components.`,
    );
  if (globalInfo(D, a) || globalInfo(D, b))
    return say(
      "Clocks, resets and SYSREF are wired as nets: click such a port to choose its net.",
    );
  const isBind = a.kind === "edge" || b.kind === "edge";
  if (!isBind && sl.parts[a.part].col === sl.parts[b.part].col)
    return say("Same column: move one of them first.");
  const same = (w) =>
    (endStr(w.a) === endStr(a) && endStr(w.b) === endStr(b)) ||
    (endStr(w.a) === endStr(b) && endStr(w.b) === endStr(a));
  if (drawnWires(D).some(same))
    return say(`${endStr(a)} and ${endStr(b)} are already wired.`);
  const ua = portUsage(D, a),
    ub = portUsage(D, b);
  if (ua.type && ub.type && !interfacesFit(ua, ub, isBind)) {
    const ta = short(ua.type) + (ua.conjugated ? "~" : ""),
      tb = short(ub.type) + (ub.conjugated ? "~" : "");
    alert(
      `${endStr(a)} (${ta}) and ${endStr(b)} (${tb}) do not fit: ` +
        (isBind
          ? "a sheet port and the component port it delegates to need the same interface."
          : `a connection joins the two roles of one interface (${ta} goes with ${counterpart(short(ua.type))}).`),
    );
    return say("");
  }
  const owner = (e) => (e.kind === "edge" ? D : partType(D, e.part));
  const wiredElsewhere = (e) =>
    drawnWires(D).some(
      (w) => endStr(w.a) === endStr(e) || endStr(w.b) === endStr(e),
    );
  const turned = [];
  const face = (e, side) => {
    // turn a component port to `side` if nothing else is wired to it
    if (
      e.kind !== "part" ||
      portLayout(owner(e), e.port).side === side ||
      wiredElsewhere(e)
    )
      return;
    setPortSide(owner(e), e.port, side);
    turned.push(endStr(e));
  };
  mutate(() => {
    if (ua.type && !ub.type)
      typePort(owner(b), b.port, isBind ? ua.type : counterpart(ua.type));
    if (ub.type && !ua.type)
      typePort(owner(a), a.port, isBind ? ub.type : counterpart(ub.type));
    const d = partDef(D);
    if (isBind) {
      const edge = a.kind === "edge" ? a : b,
        part = a.kind === "edge" ? b : a;
      if (!wiredElsewhere(edge))
        sl.edge[edge.port].side =
          sl.parts[part.part].col >= sl.columns / 2 ? "right" : "left";
      face(part, sl.edge[edge.port].side);
      (d.bindings = d.bindings || []).push({ ends: [edge.port, endStr(part)] });
    } else {
      const [left, right] =
        sl.parts[a.part].col < sl.parts[b.part].col ? [a, b] : [b, a];
      face(left, "right");
      face(right, "left");
      (d.connections = d.connections || []).push({
        ends: [endStr(left), endStr(right)],
      });
    }
  });
  hint(
    `Wired ${endStr(a)} ${isBind ? "=" : "–"} ${endStr(b)}.` +
      (turned.length ? ` Turned ${turned.join(", ")} to face the wire.` : ""),
  );
}
function addComponent(D, col, y, kindOrDef, isDef) {
  const pkg = pkgOf(D);
  const suggestion = isDef
    ? uniquePartName(D, snake(kindOrDef))
    : uniquePartName(D, kindOrDef === "HwPart" ? "hw" : snake(kindOrDef));
  const name = askName(
    isDef ? `Instance name for a ${kindOrDef}` : `Name of the new ${kindOrDef}`,
    suggestion,
  );
  if (!name) return;
  if (partsOf(D).some((p) => p.name === name)) {
    alert(`${D} already has a part called ${name}.`);
    return;
  }
  mutate(() => {
    let type = kindOrDef;
    if (!isDef) {
      type = uniqueDefName(pascal(name));
      (pkg.model.package.partDefs = pkg.model.package.partDefs || []).push({
        name: type,
        specializes: [kindOrDef],
      });
      ensureImport(pkg, kindOrDef);
    } else ensureImport(pkg, type);
    const d = partDef(D);
    (d.parts = d.parts || []).push({ name, type });
    sheetLayout(D).parts[name] = { col, y: Math.max(G.TOP + 10, y), h: G.MINH };
  });
}
function renamePart(D, old, nu) {
  mutate(() => {
    const d = partDef(D);
    d.parts.find((p) => p.name === old).name = nu;
    const fix = (s) =>
      s === old ? nu : s.startsWith(old + ".") ? nu + s.slice(old.length) : s;
    for (const c of [...(d.connections || []), ...(d.bindings || [])])
      c.ends = c.ends.map(fix);
    for (const a of d.allocations || []) {
      a.from = fix(a.from);
      a.to = fix(a.to);
    }
    const sl = sheetLayout(D);
    sl.parts[nu] = sl.parts[old];
    delete sl.parts[old];
  });
}
function renamePort(P, old, nu) {
  mutate(() => {
    portsOfDef(P).find((p) => p.name === old).name = nu;
    for (const n in S.defs) {
      // every sheet that uses P
      const e = S.defs[n];
      if (e.coll !== "partDefs") continue;
      for (const part of e.def.parts || [])
        if (short(part.type) === P) {
          const from = `${part.name}.${old}`;
          for (const c of [
            ...(e.def.connections || []),
            ...(e.def.bindings || []),
          ])
            c.ends = c.ends.map((s) => (s === from ? `${part.name}.${nu}` : s));
        }
    }
    const d = partDef(P); // P's own binds (its edge)
    for (const c of d.bindings || [])
      c.ends = c.ends.map((s) =>
        s === old ? nu : s.startsWith(old + ".") ? nu + s.slice(old.length) : s,
      );
    const L = layoutOf(pkgOf(P));
    if (L.ports[P] && L.ports[P][old]) {
      L.ports[P][nu] = L.ports[P][old];
      delete L.ports[P][old];
    }
    const sl = L.sheets[P];
    if (sl && sl.edge[old]) {
      sl.edge[nu] = sl.edge[old];
      delete sl.edge[old];
    }
  });
}
function renameDef(old, nu) {
  mutate(() => {
    const pkg = pkgOf(old);
    S.defs[old].def.name = nu;
    for (const p of S.pkgs)
      for (const coll of COLLS)
        for (const d of p.model.package[coll] || []) {
          if (d.specializes)
            d.specializes = d.specializes.map((s) =>
              short(s) === old ? nu : s,
            );
          for (const u of [...(d.parts || []), ...(d.ports || [])])
            if (u.type && short(u.type) === old) u.type = nu;
          if (d.conjugateOf === old) d.conjugateOf = nu;
        }
    const L = layoutOf(pkg);
    if (L.sheets[old]) {
      L.sheets[nu] = L.sheets[old];
      delete L.sheets[old];
    }
    if (L.ports[old]) {
      L.ports[nu] = L.ports[old];
      delete L.ports[old];
    }
    if (S.sheet === old) S.sheet = nu;
    S.back = S.back.map((b) => (b === old ? nu : b));
  });
}
function deletePart(D, name) {
  mutate(() => {
    const d = partDef(D);
    d.parts = d.parts.filter((p) => p.name !== name);
    const hit = (s) => s === name || s.startsWith(name + ".");
    d.connections = (d.connections || []).filter((c) => !c.ends.some(hit));
    d.bindings = (d.bindings || []).filter((c) => !c.ends.some(hit));
    d.allocations = (d.allocations || []).filter(
      (a) => !hit(a.to) && !hit(a.from),
    );
    for (const k of ["connections", "bindings", "allocations", "parts"])
      if (d[k] && !d[k].length) delete d[k];
    delete sheetLayout(D).parts[name];
    if (S.sel && S.sel.name === name) S.sel = null;
  });
}
function deletePort(P, name) {
  mutate(() => {
    const d = partDef(P);
    d.ports = d.ports.filter((p) => p.name !== name);
    if (!d.ports.length) delete d.ports;
    for (const n in S.defs) {
      const e = S.defs[n];
      if (e.coll !== "partDefs") continue;
      const refs = new Set(
        (e.def.parts || [])
          .filter((p) => short(p.type) === P)
          .map((p) => `${p.name}.${name}`),
      );
      if (n === P) refs.add(name);
      for (const k of ["connections", "bindings"]) {
        if (!e.def[k]) continue;
        e.def[k] = e.def[k].filter((c) => !c.ends.some((s) => refs.has(s)));
        if (!e.def[k].length) delete e.def[k];
      }
    }
    const L = layoutOf(pkgOf(P));
    if (L.ports[P]) delete L.ports[P][name];
    if (L.sheets[P]) delete L.sheets[P].edge[name];
  });
}
function deleteWire(D, w) {
  mutate(() => {
    const d = partDef(D),
      k = w.kind === "connect" ? "connections" : "bindings";
    d[k].splice(w.idx, 1);
    if (!d[k].length) delete d[k];
  });
}
function typePort(P, name, type) {
  const p = portsOfDef(P).find((x) => x.name === name);
  if (type) {
    p.type = type;
    ensureImport(pkgOf(P), type);
  } else delete p.type;
  const keyOrder = ["name", "label", "type", "conjugated", "doc", "redefines"];
  const copy = Object.assign({}, p);
  for (const k in p) delete p[k];
  for (const k of keyOrder) if (k in copy) p[k] = copy[k];
  for (const k in copy) if (!(k in p)) p[k] = copy[k]; // never drop a key it does not know
}
function setPortType(P, name, type) {
  // Set a port's interface; on the open sheet, an untyped port at the other end of its
  // wire gets the matching role too: the mirror across a connect, the same across a bind.
  const done = [];
  mutate(() => {
    typePort(P, name, type);
    if (!type || !S.sheet || !partDef(S.sheet)) return;
    const D = S.sheet;
    const isMe = (e) =>
      e.kind === "edge"
        ? P === D && e.port === name
        : partType(D, e.part) === P && e.port === name;
    for (const w of drawnWires(D)) {
      const other = isMe(w.a) ? w.b : isMe(w.b) ? w.a : null;
      if (!other) continue;
      const u = portUsage(D, other);
      if (!u || u.type) continue;
      const t = w.kind === "bind" ? type : counterpart(type);
      typePort(
        other.kind === "edge" ? D : partType(D, other.part),
        other.port,
        t,
      );
      done.push(`${endStr(other)} : ${t}`);
    }
  });
  if (done.length) hint(`Also typed the other end: ${done.join(", ")}.`);
}
function insertColumn(D, at) {
  mutate(() => {
    const sl = sheetLayout(D);
    for (const q of Object.values(sl.parts)) if (q.col >= at) q.col++;
    sl.columns++;
  });
}
function otherSide(s) {
  return s === "left" ? "right" : "left";
}
function setPortSide(P, port, side) {
  // one side per port of a part def: on every instance of it, and on its own sheet's edge (as in HA 1)
  portLayout(P, port).side = side;
  const sl = layoutOf(pkgOf(P)).sheets[P];
  if (sl && sl.edge[port]) sl.edge[port].side = side;
}
function sideOf(P, port, isEdge) {
  return isEdge ? sheetLayout(P).edge[port].side : portLayout(P, port).side;
}
function flipPorts(list) {
  // list: [{P, port, isEdge}]
  mutate(() => {
    for (const x of list)
      setPortSide(x.P, x.port, otherSide(sideOf(x.P, x.port, x.isEdge)));
  });
}
function flipComponent(D, name) {
  const P = partType(D, name);
  flipPorts(portsOfDef(P).map((p) => ({ P, port: p.name, isEdge: false })));
  hint(
    `Flipped ${name}: its ports swapped sides (on every instance of ${P}, and on ${P}'s own sheet).`,
  );
}
const pickKey = (P, port) => `${P}.${port}`;
function isPicked(P, port) {
  return S.picked.some((x) => pickKey(x.P, x.port) === pickKey(P, port));
}
function togglePick(P, port, isEdge) {
  if (isPicked(P, port))
    S.picked = S.picked.filter(
      (x) => pickKey(x.P, x.port) !== pickKey(P, port),
    );
  else S.picked.push({ P, port, isEdge });
  render();
  hint(
    S.picked.length
      ? `${S.picked.length} port(s) picked: press F (or right-click one) to move them to the other side. Esc clears.`
      : "",
  );
}
function moveColumn(D, name, by) {
  const sl = sheetLayout(D),
    q = sl.parts[name],
    to = q.col + by;
  if (to < 0 || to >= sl.columns) {
    hint(`No column there: right-click a gutter to add one.`);
    return;
  }
  mutate(() => {
    q.col = to;
  });
}
function removeColumn(D, c) {
  const sl = sheetLayout(D);
  if (Object.values(sl.parts).some((q) => q.col === c)) {
    hint("Only an empty column can be removed.");
    return;
  }
  mutate(() => {
    for (const q of Object.values(sl.parts)) if (q.col > c) q.col--;
    sl.columns = Math.max(1, sl.columns - 1);
  });
}

// ------------------------------------------------------------------ context menu
function menu(x, y, items) {
  const m = $("menu");
  m.innerHTML = "";
  for (const it of items) {
    if (!it) continue;
    const d = document.createElement("div");
    if (it.sep) d.className = "sep";
    else if (it.head) {
      d.className = "hd";
      d.textContent = it.head;
    } else {
      d.className = "mi" + (it.danger ? " danger" : "");
      d.textContent = it.label;
      d.onclick = () => {
        hideMenu();
        it.act();
      };
    }
    m.appendChild(d);
  }
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 8) + "px";
  m.style.top = Math.min(y, innerHeight - r.height - 8) + "px";
  m.style.maxHeight = innerHeight - 16 + "px";
  m.style.overflow = "auto";
}
function hideMenu() {
  $("menu").hidden = true;
}
function portDefMenu(x, y, P, port, cur) {
  const groups = {};
  for (const n of Object.keys(S.defs).sort()) {
    const e = S.defs[n];
    if (e.coll !== "portDefs") continue;
    (groups[e.pkg.model.package.name] =
      groups[e.pkg.model.package.name] || []).push(n);
  }
  const items = [
    { head: `Interface of ${port}` },
    cur
      ? { label: "(none: untyped)", act: () => setPortType(P, port, null) }
      : null,
  ];
  for (const g of Object.keys(groups).sort()) {
    items.push({ head: g });
    for (const n of groups[g])
      items.push({
        label:
          (n === cur ? "✓ " : "") +
          n +
          (S.defs[n].def.conjugateOf
            ? `  (mirror of ${S.defs[n].def.conjugateOf})`
            : ""),
        act: () => setPortType(P, port, n),
      });
  }
  menu(x, y, items);
}
function libraryMenu(x, y, D, col, yy) {
  const items = [{ head: "Add an instance of" }];
  for (const n of Object.keys(S.defs).sort()) {
    const e = S.defs[n];
    if (
      e.coll === "partDefs" &&
      !e.def.isAbstract &&
      !KIND_COLORS[n] &&
      n !== D
    )
      items.push({
        label: `${n}  (${kindOf(n) || "part"})`,
        act: () => addComponent(D, col, yy, n, true),
      });
  }
  menu(x, y, items);
}
function kindsAvailable() {
  return Object.keys(KIND_COLORS).filter(
    (k) => partDef(k) && k !== "FpgaComponent" && k !== "Container",
  );
}

// ------------------------------------------------------------------ render
function render() {
  renderSide();
  renderCrumbs();
  const svg = $("canvas");
  svg.innerHTML = "";
  if (!S.sheet || !partDef(S.sheet)) {
    svg.setAttribute("width", 600);
    svg.setAttribute("height", 200);
    el("text", { x: 20, y: 40 }, svg, "No sheet: pick one on the left.");
    renderProblems();
    return;
  }
  const D = S.sheet,
    d = partDef(D),
    sl = sheetLayout(D),
    geo = geometry(D);
  const { hidden } = wiresOf(D),
    wires = drawnWires(D),
    { byEnd } = netsOf(D);
  let maxY = 420;
  for (const q of Object.values(sl.parts))
    maxY = Math.max(maxY, q.y + q.h + 60);
  for (const e of Object.values(sl.edge)) maxY = Math.max(maxY, e.y + 60);
  svg.setAttribute("width", geo.width);
  svg.setAttribute("height", maxY);

  // bands
  const band = (x0, x1, cls, ctx, attrs) => {
    const r = el(
      "rect",
      Object.assign(
        {
          x: x0,
          y: G.TOP - 20,
          width: x1 - x0,
          height: maxY - G.TOP + 10,
          class: cls,
        },
        attrs || {},
      ),
      svg,
    );
    r.oncontextmenu = ctx;
    return r;
  };
  for (const side of ["left", "right"]) {
    const b = band(
      side === "left" ? geo.edgeL.x0 : geo.edgeR.x0,
      side === "left" ? geo.edgeL.x1 : geo.edgeR.x1,
      "band-edge",
      (e) => edgeMenu(e, side),
    );
    b.onclick = (e) => edgeClick(e, side);
    b.onmousedown = (e) => {
      if (e.shiftKey && e.button === 0) {
        e.preventDefault();
        S.band = { side, y0: svgPoint(e).y };
      }
    };
  }
  geo.gutters.forEach((g, i) =>
    band(g.x0, g.x1, "band-gutter", (e) => {
      e.preventDefault();
      menu(e.clientX, e.clientY, [
        { label: "Add column here", act: () => insertColumn(D, i) },
      ]);
    }),
  );
  geo.cols.forEach(
    (c, i) =>
      (band(c.x0, c.x1, "band-col", (e) => colMenu(e, i), {
        "data-col": i,
      }).onclick = () => {
        if (S.sel) {
          S.sel = null;
          render();
        }
      }),
  );

  // title
  el("text", { x: G.LEFT, y: 22, class: "title" }, svg, `${D}`);
  el(
    "text",
    { x: G.LEFT, y: 38, class: "subtitle" },
    svg,
    `${kindOf(D) || "part def"} · package ${pkgOf(D).model.package.name}${hidden ? ` · ${hidden} wire(s) through deeper features not drawn` : ""}`,
  );
  el(
    "text",
    { x: geo.edgeL.x0 + 4, y: G.TOP - 6, class: "subtitle" },
    svg,
    "ports",
  );
  el(
    "text",
    { x: geo.edgeR.x0 + 4, y: G.TOP - 6, class: "subtitle" },
    svg,
    "ports",
  );

  // wires (under components)
  for (const w of wires) {
    const A = absPort(D, geo, w.a),
      B = absPort(D, geo, w.b);
    if (!A || !B) continue;
    const [L, R] = A.x <= B.x ? [A, B] : [B, A];
    let path;
    if (Math.abs(L.y - R.y) < 0.5) path = `M${L.x},${L.y} H${R.x}`;
    else {
      const mx =
        R.side === "left"
          ? R.x - 14
          : L.side === "right"
            ? L.x + 14
            : (L.x + R.x) / 2;
      path = `M${L.x},${L.y} H${mx} V${R.y} H${R.x}`;
    }
    const p = el(
      "path",
      { d: path, class: "wire" + (w.kind === "bind" ? " bind" : "") },
      svg,
    );
    tip(
      p,
      w.kind === "bind"
        ? `bind ${endStr(w.a)} = ${endStr(w.b)}`
        : `connect ${endStr(w.a)} to ${endStr(w.b)}`,
    );
    p.oncontextmenu = (e) => {
      e.preventDefault();
      menu(e.clientX, e.clientY, [
        { head: w.kind },
        { label: "Delete wire", danger: true, act: () => deleteWire(D, w) },
      ]);
    };
  }

  // edge ports
  for (const port of d.ports || []) {
    const e = sl.edge[port.name];
    if (!e) continue;
    const x = e.side === "left" ? geo.edgeL.x1 - G.PORT_W : geo.edgeR.x0;
    const armed =
      S.armed && S.armed.kind === "edge" && S.armed.port === port.name;
    const gEnd = { kind: "edge", port: port.name },
      gi = globalInfo(D, gEnd),
      net = byEnd[port.name];
    const r = el(
      "rect",
      {
        x,
        y: e.y - G.PORT_H / 2,
        width: G.PORT_W,
        height: G.PORT_H,
        class:
          "edge-port" +
          (port.type ? "" : " untyped") +
          (armed ? " armed" : "") +
          (isPicked(D, port.name) ? " picked" : "") +
          (gi ? " gport " + gi.cat : ""),
        "data-edge": port.name,
      },
      svg,
    );
    if (gi) r.style.fill = net ? net.color : "#b0b6bf";
    tip(
      r,
      `${port.label ? port.label + "\n" : ""}${port.name} : ${port.type || "(no interface yet)"}${port.doc ? "\n" + port.doc : ""}${gi ? `\n${gi.cat}${net ? " net " + net.name + " (" + net.members.length + " ports)" : ", on no net"}. Click for its net.` : ""}`,
    );
    const tx =
      e.side === "left"
        ? geo.edgeL.x1 - G.PORT_W - 4
        : geo.edgeR.x0 + G.PORT_W + 4;
    const anchor = e.side === "left" ? "end" : "start";
    el(
      "text",
      { x: tx, y: e.y - 1, "text-anchor": anchor, class: "port-label" },
      svg,
      trunc(shown(port), 17),
    );
    const sub =
      (gi && net && net.freq
        ? `${short(port.type)} · ${fmtHz(net.freq)}`
        : port.type) + (pairedClock(port) ? ` @${pairedClock(port)}` : "");
    if (sub)
      el(
        "text",
        { x: tx, y: e.y + 10, "text-anchor": anchor, class: "port-type" },
        svg,
        trunc(sub, 21),
      );
    r.onmousedown = (ev) =>
      startDrag(ev, { kind: "edge", port: port.name, y0: e.y });
    r.oncontextmenu = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      portMenu(ev, D, port.name, true);
    };
  }

  // components
  for (const part of d.parts || []) {
    const q = sl.parts[part.name],
      c = geo.cols[q.col];
    if (!c) continue;
    const P = short(part.type),
      kind = kindOf(P),
      color = KIND_COLORS[kind] || "#888";
    const g = el("g", {}, svg);
    const sel = S.sel && S.sel.kind === "part" && S.sel.name === part.name;
    const r = el(
      "rect",
      {
        x: c.x0,
        y: q.y,
        width: G.COMP_W,
        height: q.h,
        class: "comp" + (sel ? " sel" : ""),
        fill: color,
        "data-part": part.name,
      },
      g,
    );
    el(
      "text",
      {
        x: c.x0 + G.COMP_W / 2,
        y: q.y + 20,
        "text-anchor": "middle",
        class: "comp-name on-kind",
        "pointer-events": "none",
      },
      g,
      trunc(part.name, 22),
    );
    el(
      "text",
      {
        x: c.x0 + G.COMP_W / 2,
        y: q.y + 34,
        "text-anchor": "middle",
        class: "comp-type on-kind",
        "pointer-events": "none",
      },
      g,
      trunc(`${P}${kind && kind !== P ? " · " + kind : ""}`, 28),
    );
    tip(
      r,
      `${part.name} : ${P}${partDef(P) && partDef(P).doc ? "\n" + partDef(P).doc : ""}\nDouble-click to open its sheet.`,
    );
    r.onmousedown = (ev) =>
      startDrag(ev, { kind: "part", part: part.name, y0: q.y, col0: q.col });
    r.ondblclick = () => openSheet(P);
    r.oncontextmenu = (ev) => {
      ev.preventDefault();
      compMenu(ev, D, part.name);
    };
    const grip = el(
      "rect",
      {
        x: c.x0 + 8,
        y: q.y + q.h - 4,
        width: G.COMP_W - 16,
        height: 8,
        class: "grip",
      },
      g,
    );
    tip(grip, "Drag to resize");
    grip.onmousedown = (ev) =>
      startDrag(ev, { kind: "resize", part: part.name, h0: q.h });
    const topGrip = el(
      "rect",
      {
        x: c.x0 + 8,
        y: q.y - 4,
        width: G.COMP_W - 16,
        height: 8,
        class: "grip",
      },
      g,
    );
    tip(
      topGrip,
      "Drag to resize from the top (ports stay where they are; ones in the way move down, and their wires follow)",
    );
    topGrip.onmousedown = (ev) =>
      startDrag(ev, {
        kind: "resizeTop",
        part: part.name,
        P,
        y0: q.y,
        h0: q.h,
        offs: Object.fromEntries(
          portsOfDef(P).map((x) => [x.name, portLayout(P, x.name).offset]),
        ),
      });
    if (!partDef(P)) {
      el(
        "text",
        { x: c.x0 + 8, y: q.y + 52, class: "subtitle" },
        g,
        `${P}: not found`,
      );
      continue;
    }
    for (const port of portsOfDef(P)) {
      const l = portLayout(P, port.name);
      const px = l.side === "left" ? c.x0 - G.PORT_W / 2 : c.x1 - G.PORT_W / 2,
        py = q.y + l.offset;
      const armed =
        S.armed &&
        S.armed.kind === "part" &&
        S.armed.part === part.name &&
        S.armed.port === port.name;
      const gEnd = { kind: "part", part: part.name, port: port.name },
        gi = globalInfo(D, gEnd),
        net = byEnd[endStr(gEnd)];
      const pr = el(
        "rect",
        {
          x: px,
          y: py - G.PORT_H / 2,
          width: G.PORT_W,
          height: G.PORT_H,
          class:
            "port" +
            (port.type ? "" : " untyped") +
            (armed ? " armed" : "") +
            (isPicked(P, port.name) ? " picked" : "") +
            (gi ? " gport " + gi.cat : ""),
          "data-part": part.name,
          "data-port": port.name,
        },
        g,
      );
      if (gi) {
        pr.style.fill = net ? net.color : "#b0b6bf";
        const tagX =
          l.side === "left" ? c.x0 - G.PORT_W / 2 - 4 : c.x1 + G.PORT_W / 2 + 4;
        el(
          "text",
          {
            x: tagX,
            y: py + 4,
            "text-anchor": l.side === "left" ? "end" : "start",
            class: "net-tag",
            style: `fill:${net ? net.color : "#8a8f98"}`,
            "pointer-events": "none",
          },
          g,
          trunc(
            net
              ? (gi.source ? "▸" : "◂") + " " + net.name.split(".").pop()
              : "(no net)",
            16,
          ),
        );
      }
      const pc = pairedClock(port);
      if (pc && portsOfDef(P).some((x) => x.name === pc)) {
        // a bracket to its sampling clock
        const cl = portLayout(P, pc),
          cy = q.y + cl.offset;
        if (cl.side === l.side) {
          const bx = l.side === "left" ? c.x0 + 3 : c.x1 - 3;
          el(
            "path",
            {
              d: `M${bx},${py} H${bx + (l.side === "left" ? 3 : -3)} V${cy} H${bx}`,
              class: "pair",
              style: `stroke:${net ? net.color : "#8a8f98"}`,
              "pointer-events": "none",
            },
            g,
          );
        }
      }
      tip(
        pr,
        `${port.label ? port.label + "\n" : ""}${part.name}.${port.name} : ${port.type || "(no interface yet)"}${port.doc ? "\n" + port.doc : ""}` +
          (pc ? `\nsampled by ${pc}` : "") +
          (gi
            ? `\n${gi.cat}${net ? " net " + net.name + (net.freq ? ", " + fmtHz(net.freq) : "") : ", on no net"}. Click to choose its net.`
            : "\nClick, then click a component or the edge to wire it."),
      );
      const lx = l.side === "left" ? c.x0 + 8 : c.x1 - 8,
        anchor = l.side === "left" ? "start" : "end";
      // a port facing it on the other side at about the same height: half the width each
      const crowded = portsOfDef(P).some(
        (o) =>
          o.name !== port.name &&
          portLayout(P, o.name).side !== l.side &&
          Math.abs(portLayout(P, o.name).offset - l.offset) < G.PGAP,
      );
      const label =
        port.type && !crowded && !gi
          ? `${shown(port)} · ${short(port.type)}`
          : pc
            ? `${shown(port)} @${pc}`
            : shown(port);
      el(
        "text",
        {
          x: lx,
          y: py + 4,
          "text-anchor": anchor,
          class: "port-label on-kind",
          "pointer-events": "none",
        },
        g,
        trunc(label, crowded ? 13 : 25),
      );
      pr.onmousedown = (ev) =>
        startDrag(ev, {
          kind: "port",
          part: part.name,
          P,
          port: port.name,
          off0: l.offset,
        });
      pr.oncontextmenu = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        portMenu(ev, P, port.name, false);
      };
    }
  }
  renderProblems();
  if (typeof CT !== "undefined" && CT.open) renderClockTree(); // keep the clock tree in step
}
function renderSide() {
  const sheets = $("sheets");
  sheets.innerHTML = "";
  const byPkg = {};
  for (const n of Object.keys(S.defs).sort())
    if (S.defs[n].coll === "partDefs" && isSheet(n))
      (byPkg[S.defs[n].pkg.model.package.name] =
        byPkg[S.defs[n].pkg.model.package.name] || []).push(n);
  for (const g of Object.keys(byPkg).sort()) {
    const h = document.createElement("div");
    h.className = "group";
    h.textContent = g;
    sheets.appendChild(h);
    for (const n of byPkg[g]) {
      const it = document.createElement("div");
      it.className = "item" + (n === S.sheet ? " cur" : "");
      it.style.borderLeftColor = KIND_COLORS[kindOf(n)] || "transparent";
      it.textContent = n;
      it.onclick = () => openSheet(n);
      sheets.appendChild(it);
    }
  }
  const lib = $("library");
  lib.innerHTML = "";
  const f = $("libFilter").value.toLowerCase();
  const byKind = {};
  for (const n of Object.keys(S.defs).sort()) {
    const e = S.defs[n];
    if (
      e.coll !== "partDefs" ||
      e.def.isAbstract ||
      KIND_COLORS[n] ||
      (f && !n.toLowerCase().includes(f))
    )
      continue;
    (byKind[kindOf(n) || "other"] = byKind[kindOf(n) || "other"] || []).push(n);
  }
  for (const k of Object.keys(byKind).sort()) {
    const h = document.createElement("div");
    h.className = "group";
    h.textContent = k;
    lib.appendChild(h);
    for (const n of byKind[k]) {
      const it = document.createElement("div");
      it.className = "item";
      it.draggable = true;
      it.style.borderLeftColor = KIND_COLORS[k] || "transparent";
      it.textContent = n;
      it.title =
        (S.defs[n].def.doc || "") + "\nDrag onto a column to add an instance.";
      it.ondragstart = (e) => e.dataTransfer.setData("text/x-partdef", n);
      lib.appendChild(it);
    }
  }
  renderNets();
  const ifs = $("interfaces");
  ifs.innerHTML = "";
  for (const n of Object.keys(S.defs).sort()) {
    const e = S.defs[n];
    if (e.coll !== "portDefs") continue;
    const it = document.createElement("div");
    it.className = "item";
    it.draggable = true;
    it.textContent = n + (e.def.conjugateOf ? ` ↔ ${e.def.conjugateOf}` : "");
    const base = e.def.conjugateOf ? portDef(e.def.conjugateOf) : e.def;
    it.title =
      (e.def.doc || "") +
      "\n" +
      ((base && base.attributes) || [])
        .concat((base && base.items) || [])
        .filter((a) => a.direction)
        .map(
          (a) =>
            `${e.def.conjugateOf ? { in: "out", out: "in", inout: "inout" }[a.direction] : a.direction} ${a.name}`,
        )
        .join(", ") +
      "\nDrag onto a port to set its interface.";
    it.ondragstart = (ev) => ev.dataTransfer.setData("text/x-portdef", n);
    ifs.appendChild(it);
  }
}
function renderNets() {
  const box = $("nets");
  if (!box) return;
  box.innerHTML = "";
  const D = S.sheet;
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
    const row = div("net" + (S.armedNet === n.name ? " armed" : ""));
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
    row.onclick = () => armNet(S.armedNet === n.name ? null : n);
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
function renderCrumbs() {
  const c = $("crumbs");
  c.innerHTML = "";
  // the chain of sheets that contain this one (first containing def found)
  const chain = [];
  let cur = S.sheet;
  const seen = new Set();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    chain.unshift(cur);
    cur = Object.keys(S.defs).find(
      (n) =>
        S.defs[n].coll === "partDefs" &&
        (S.defs[n].def.parts || []).some((p) => short(p.type) === cur),
    );
  }
  chain.forEach((n, i) => {
    if (i) c.appendChild(document.createTextNode(" › "));
    const a = document.createElement(n === S.sheet ? "span" : "a");
    a.textContent = n;
    if (n === S.sheet) a.className = "cur";
    else a.onclick = () => openSheet(n);
    c.appendChild(a);
  });
}
function renderProblems() {
  const f = $("problems");
  f.innerHTML = "";
  const add = (cls, t) => {
    const d = document.createElement("div");
    d.className = "p " + cls;
    d.textContent = t;
    f.appendChild(d);
  };
  for (const p of S.saveProblems) add("err", "not saved: " + p);
  for (const p of S.serverProblems) add("err", p);
  if (S.sheet && partDef(S.sheet)) {
    const D = S.sheet,
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
      for (const port of portsOfDef(short(part.type))) {
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
      const ta = short(a.type) + (a.conjugated ? "~" : ""),
        tb = short(b.type) + (b.conjugated ? "~" : "");
      const ok =
        w.kind === "bind"
          ? ta === tb
          : (counterpart(short(a.type)) === short(b.type) &&
              !a.conjugated &&
              !b.conjugated) ||
            (short(a.type) === short(b.type) &&
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

// ------------------------------------------------------------------ interaction
function openSheet(n) {
  if (!partDef(n)) return;
  if (
    !isSheet(n) &&
    !confirm(`${n} has no parts yet. Open it as a sheet to add some?`)
  )
    return;
  if (S.sheet && S.sheet !== n) S.back.push(S.sheet);
  S.sheet = n;
  S.sel = null;
  S.armed = null;
  history.replaceState(null, "", "#" + n);
  settle(n);
  render();
  hint();
}
function goBack() {
  const b = S.back.pop();
  if (b && partDef(b)) {
    S.sheet = b;
    S.sel = null;
    S.armed = null;
    history.replaceState(null, "", "#" + b);
    settle(b);
    render();
  }
}
function svgPoint(ev) {
  const r = $("canvas").getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}

function startDrag(ev, what) {
  if (ev.button !== 0) return;
  ev.stopPropagation();
  S.drag = Object.assign(
    {
      x0: ev.clientX,
      y0m: ev.clientY,
      moved: false,
      ctrl: ev.ctrlKey || ev.metaKey,
      shift: ev.shiftKey,
      snap: snapshot(),
    },
    what,
  );
}
window.addEventListener("mousemove", (ev) => {
  const d = S.drag;
  if (!d) return;
  const dx = ev.clientX - d.x0,
    dy = ev.clientY - d.y0m;
  if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
  d.moved = true;
  const D = S.sheet,
    sl = sheetLayout(D);
  if (d.kind === "part") {
    sl.parts[d.part].y = Math.max(G.TOP + 10, d.y0 + dy);
    const geo = geometry(D);
    sl.parts[d.part].col = columnAt(geo, svgPoint(ev).x);
  } else if (d.kind === "edge")
    sl.edge[d.port].y = Math.max(G.TOP + 10, d.y0 + dy);
  else if (d.kind === "port") {
    // a port stays inside its block: moving it never moves anything else
    const h = sl.parts[d.part].h;
    portLayout(d.P, d.port).offset = Math.min(
      Math.max(G.PMT, d.off0 + dy),
      h - G.PMB,
    );
  } else if (d.kind === "resize")
    sl.parts[d.part].h = Math.max(G.MINH, d.h0 + dy); // never above its ports (fitHeights)
  else if (d.kind === "resizeTop") {
    // the bottom stays put; ports keep their height on the sheet
    const q = sl.parts[d.part],
      bottom = d.y0 + d.h0;
    q.y = Math.min(Math.max(G.TOP + 10, d.y0 + dy), bottom - G.MINH);
    q.h = bottom - q.y;
    for (const n in d.offs)
      portLayout(d.P, n).offset = Math.max(G.PMT, d.y0 + d.offs[n] - q.y);
    fitHeights(D);
  }
  render();
});
window.addEventListener("mouseup", (ev) => {
  if (S.band) {
    // Shift+drag along an edge: pick every port in the range
    const b = S.band,
      y1 = svgPoint(ev).y,
      lo = Math.min(b.y0, y1) - 6,
      hi = Math.max(b.y0, y1) + 6;
    S.band = null;
    const D = S.sheet,
      sl = sheetLayout(D);
    for (const p of portsOfDef(D)) {
      const e = sl.edge[p.name];
      if (
        e &&
        e.side === b.side &&
        e.y >= lo &&
        e.y <= hi &&
        !isPicked(D, p.name)
      )
        S.picked.push({ P: D, port: p.name, isEdge: true });
    }
    render();
    hint(
      S.picked.length
        ? `${S.picked.length} port(s) picked: press F (or right-click one) to move them to the other side. Esc clears.`
        : "",
    );
    return;
  }
  const d = S.drag;
  if (!d) return;
  S.drag = null;
  if (d.moved) {
    // a move: one undo step, then settle
    S.undo.push(d.snap);
    S.redo = [];
    // dragging a port, or a component's top past its ports, moves ports: their
    // wire partners follow them (otherwise settling would pull them back)
    const moved =
      d.kind === "port"
        ? [d.port]
        : d.kind === "resizeTop"
          ? Object.keys(d.offs).filter(
              (n) =>
                sheetLayout(S.sheet).parts[d.part].y +
                  portLayout(d.P, n).offset !==
                d.y0 + d.offs[n],
            )
          : [];
    for (const port of moved) {
      const D = S.sheet;
      const end = { kind: "part", part: d.part, port };
      for (const w of drawnWires(D)) {
        // clock/reset tags have no wire: nothing follows them
        const other =
          endStr(w.a) === endStr(end)
            ? w.b
            : endStr(w.b) === endStr(end)
              ? w.a
              : null;
        if (other) setAbsY(D, other, absPort(D, geometry(D), end).y);
      }
    }
    changed();
    return;
  }
  // a click
  if (d.kind === "part") {
    if (S.armed) {
      connectArmed({ part: d.part });
      return;
    }
    if (d.ctrl && S.sel && S.sel.kind === "part" && S.sel.name !== d.part) {
      const a = S.sel.name;
      S.sel = null;
      quickConnect(a, d.part);
      return;
    }
    S.sel =
      S.sel && S.sel.name === d.part ? null : { kind: "part", name: d.part };
    render();
    hint(
      S.sel
        ? `Selected ${d.part}. Ctrl+click another component to connect them; F flips it; Ctrl+←/→ moves it a column; Delete removes it.`
        : "",
    );
  } else if (
    (d.kind === "port" || d.kind === "edge") &&
    !d.shift &&
    S.armed &&
    endStr(S.armed) !==
      endStr(
        d.kind === "edge"
          ? { kind: "edge", port: d.port }
          : { kind: "part", part: d.part, port: d.port },
      )
  ) {
    connectPorts(
      S.armed,
      d.kind === "edge"
        ? { kind: "edge", port: d.port }
        : { kind: "part", part: d.part, port: d.port },
    );
  } else if (
    (d.kind === "port" || d.kind === "edge") &&
    !d.shift &&
    !S.armed &&
    globalInfo(
      S.sheet,
      d.kind === "edge"
        ? { kind: "edge", port: d.port }
        : { kind: "part", part: d.part, port: d.port },
    )
  ) {
    const D = S.sheet,
      end =
        d.kind === "edge"
          ? { kind: "edge", port: d.port }
          : { kind: "part", part: d.part, port: d.port };
    const info = globalInfo(D, end),
      { nets, byEnd } = netsOf(D);
    const armedNet = S.armedNet && nets.find((n) => n.name === S.armedNet);
    if (armedNet && !info.source && info.cat === armedNet.cat)
      assignNet(D, end, byEnd[endStr(end)] === armedNet ? null : armedNet);
    else if (
      armedNet &&
      !info.source &&
      confirm(
        `${armedNet.name} is a ${armedNet.cat} net and ${endStr(end)} is a ${info.cat} port.\nMake ${endStr(end)} a ${armedNet.cat} input and put it on ${armedNet.name}?`,
      )
    )
      retypeAndAssign(D, end, armedNet);
    else if (armedNet && info.source)
      hint(
        `${endStr(end)} drives a net itself, so it cannot go on ${armedNet.name}.`,
      );
    else netMenu(ev, D, end);
  } else if ((d.kind === "port" || d.kind === "edge") && d.shift) {
    togglePick(d.kind === "edge" ? S.sheet : d.P, d.port, d.kind === "edge");
  } else if (d.kind === "port" || d.kind === "edge") {
    const end =
      d.kind === "edge"
        ? { kind: "edge", port: d.port }
        : { kind: "part", part: d.part, port: d.port };
    S.armed = S.armed && endStr(S.armed) === endStr(end) ? null : end;
    render();
    hint(
      S.armed
        ? `Wiring ${endStr(end)}: click another port to wire the two, or a component (new port + wire)${end.kind === "part" ? " or a sheet edge (new sheet port + bind)" : ""}. Esc cancels.`
        : "",
    );
  }
});
function edgeClick(ev, side) {
  if (S.armed && S.armed.kind === "part")
    connectArmed({ edge: side, y: svgPoint(ev).y });
}
function edgeMenu(ev, side) {
  ev.preventDefault();
  const D = S.sheet,
    y = svgPoint(ev).y;
  menu(ev.clientX, ev.clientY, [
    {
      label: `Add a port to ${D} (${side} edge)`,
      act: () => {
        const name = askName(`New port of ${D}`, uniquePortName(D, "port"));
        if (!name) return;
        if (portsOfDef(D).some((p) => p.name === name)) {
          alert(`${D} already has a port ${name}.`);
          return;
        }
        mutate(() => {
          const d = partDef(D);
          (d.ports = d.ports || []).push({ name });
          sheetLayout(D).edge[name] = { side, y };
        });
      },
    },
    {
      label: `Add a clock input to ${D}…`,
      act: () => addGlobalPort(D, "clock", "in", "clk", side),
    },
    {
      label: `Add a reset input to ${D}…`,
      act: () => addGlobalPort(D, "reset", "in", "rst", side),
    },
    {
      label: `Add a SYSREF input to ${D}…`,
      act: () => addGlobalPort(D, "sysref", "in", "sysref", side),
    },
  ]);
}
function colMenu(ev, col) {
  ev.preventDefault();
  const D = S.sheet,
    y = svgPoint(ev).y;
  const items = [{ head: `Column ${col + 1}` }];
  for (const k of kindsAvailable())
    items.push({
      label: `Add ${k}…`,
      act: () => addComponent(D, col, y, k, false),
    });
  items.push({
    label: "Add an instance of a library part…",
    act: () => libraryMenu(ev.clientX, ev.clientY, D, col, y),
  });
  items.push({
    label: `Description of this sheet (${D})${partDef(D) && partDef(D).doc ? " ✓" : ""}…`,
    act: () => editDoc(`Description of ${D}`, () => partDef(D)),
  });
  items.push(
    { sep: true },
    { label: "Add column to the left", act: () => insertColumn(D, col) },
    { label: "Add column to the right", act: () => insertColumn(D, col + 1) },
    {
      label: "Remove this column",
      danger: true,
      act: () => removeColumn(D, col),
    },
  );
  menu(ev.clientX, ev.clientY, items);
}
function compMenu(ev, D, name) {
  const P = partType(D, name);
  menu(ev.clientX, ev.clientY, [
    { head: `${name} : ${P}` },
    { label: "Open its sheet", act: () => openSheet(P) },
    {
      label: "Flip: swap its ports' sides  (F)",
      act: () => flipComponent(D, name),
    },
    {
      label: "Move one column left  (Ctrl+←)",
      act: () => moveColumn(D, name, -1),
    },
    {
      label: "Move one column right (Ctrl+→)",
      act: () => moveColumn(D, name, +1),
    },
    {
      label: "Add a clock input…",
      act: () => addGlobalPort(P, "clock", "in", "clk"),
    },
    {
      label: "Add a reset input…",
      act: () => addGlobalPort(P, "reset", "in", "rst"),
    },
    {
      label: "Add a clock output…",
      act: () => addGlobalPort(P, "clock", "out", "clk_out"),
    },
    {
      label: "Add a reset output…",
      act: () => addGlobalPort(P, "reset", "out", "rst_out"),
    },
    {
      label: "Add a SYSREF input…",
      act: () => addGlobalPort(P, "sysref", "in", "sysref"),
    },
    {
      label: "Add a port…",
      act: () => {
        const n = askName(`New port of ${P}`, uniquePortName(P, "port"));
        if (!n) return;
        if (portsOfDef(P).some((p) => p.name === n)) {
          alert(`${P} already has a port ${n}.`);
          return;
        }
        mutate(() => addPort(P, n, undefined, "left"));
      },
    },
    { sep: true },
    {
      label: `Description of ${P}${partDef(P) && partDef(P).doc ? " ✓" : ""}…`,
      act: () =>
        editDoc(`Description of ${P} (every instance)`, () => partDef(P)),
    },
    {
      label: "Rename instance…",
      act: () => {
        const n = askName("Instance name", name);
        if (n && n !== name) renamePart(D, name, n);
      },
    },
    {
      label: `Rename definition ${P}…`,
      act: () => {
        const n = askName("Definition name", P);
        if (n && n !== P) {
          if (S.defs[n]) alert(`${n} already exists.`);
          else renameDef(P, n);
        }
      },
    },
    {
      label: `Kind: ${kindOf(P) || "none"}…`,
      act: () => {
        const items = [{ head: `${P} is a…` }];
        for (const k of kindsAvailable())
          items.push({
            label: (k === kindOf(P) ? "✓ " : "") + k,
            act: () =>
              mutate(() => {
                const d = partDef(P),
                  cur = kindOf(P);
                d.specializes = (d.specializes || []).filter(
                  (x) => short(x) !== cur,
                );
                d.specializes.unshift(k);
                ensureImport(pkgOf(P), k);
                const order = ["name", "doc", "isAbstract", "specializes"]; // keep schema key order
                const copy = Object.assign({}, d);
                for (const x in d) delete d[x];
                for (const x of order) if (x in copy) d[x] = copy[x];
                for (const x in copy) if (!(x in d)) d[x] = copy[x];
              }),
          });
        if (items.length === 1)
          items.push({
            head: "No kinds in the model (part defs named Rtl, VendorIp, ...)",
          });
        menu(ev.clientX, ev.clientY, items);
      },
    },
    {
      label: "Change definition…",
      act: () => {
        const items = [{ head: `Type of ${name}` }];
        for (const n of Object.keys(S.defs).sort())
          if (
            S.defs[n].coll === "partDefs" &&
            !S.defs[n].def.isAbstract &&
            !KIND_COLORS[n] &&
            n !== D
          )
            items.push({
              label: (n === P ? "✓ " : "") + n,
              act: () =>
                mutate(() => {
                  partsOf(D).find((p) => p.name === name).type = n;
                  ensureImport(pkgOf(D), n);
                }),
            });
        menu(ev.clientX, ev.clientY, items);
      },
    },
    { sep: true },
    { label: "Delete", danger: true, act: () => deletePart(D, name) },
  ]);
}
// ------------------------------------------------------------------ descriptions (SysML `doc`)
const DOC_HINT =
  "Plain text for readers outside FPGA design. It goes into the VHDL comments and the documents. Empty removes it.";
function askText(title, value, hintText) {
  const dlg = $("textDlg"),
    ta = $("textDlgText");
  $("textDlgTitle").textContent = title;
  $("textDlgHint").textContent = hintText || DOC_HINT;
  ta.value = value || "";
  ta.onkeydown = (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      $("textDlgOk").click();
    }
  };
  return new Promise((resolve) => {
    dlg.onclose = () => resolve(dlg.returnValue === "ok" ? ta.value : null);
    dlg.returnValue = "";
    dlg.showModal();
    ta.focus();
  });
}
async function editDoc(title, getObj, hintText) {
  const obj = getObj();
  if (!obj) return;
  const text = await askText(title, obj.doc, hintText);
  if (text === null) return;
  const t = text
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim();
  if ((obj.doc || "") === t) return;
  mutate(() => {
    const o = getObj();
    if (t) o.doc = t;
    else delete o.doc;
  });
}
// A port's readable SysML name ("Processing CSR"); its identifier stays `name`
// (in the file: name = the readable text, shortName = the identifier).
function editLabel(P, name) {
  const port = portsOfDef(P).find((p) => p.name === name);
  if (!port) return;
  const v = prompt(
    `Name of port ${P}.${name}: a readable name for the interface, e.g. "Processing CSR". ` +
      "It heads the port in the generated VHDL and the documents; the VHDL name stays " +
      name +
      ". Empty removes it.",
    port.label || "",
  );
  if (v === null) return;
  const t = v.replace(/['\\\r\n]/g, "").trim();
  if ((port.label || "") === t) return;
  mutate(() => {
    const p = portsOfDef(P).find((q) => q.name === name);
    if (t && t !== name) p.label = t;
    else delete p.label;
  });
}
function portMenu(ev, P, name, isEdge) {
  const port = portsOfDef(P).find((p) => p.name === name);
  if (S.picked.length > 1 && isPicked(P, name)) {
    const n = S.picked.length;
    menu(ev.clientX, ev.clientY, [
      { head: `${n} ports picked` },
      {
        label: `Move the ${n} ports to the other side  (F)`,
        act: () => {
          const l = S.picked;
          S.picked = [];
          flipPorts(l);
        },
      },
      {
        label: "Set their interface…",
        act: () => {
          const items = [{ head: `Interface of ${n} ports` }];
          for (const t of Object.keys(S.defs).sort())
            if (S.defs[t].coll === "portDefs")
              items.push({
                label: t,
                act: () =>
                  mutate(() => {
                    for (const x of S.picked) {
                      const p = portsOfDef(x.P).find((q) => q.name === x.port);
                      p.type = t;
                      ensureImport(pkgOf(x.P), t);
                    }
                  }),
              });
          menu(ev.clientX, ev.clientY, items);
        },
      },
      {
        label: "Clear the selection  (Esc)",
        act: () => {
          S.picked = [];
          render();
          hint();
        },
      },
    ]);
    return;
  }
  menu(ev.clientX, ev.clientY, [
    { head: `${P}.${name}${port.type ? " : " + port.type : ""}` },
    {
      label: "Set interface…",
      act: () => portDefMenu(ev.clientX, ev.clientY, P, name, port.type),
    },
    pairable(port)
      ? {
          label: `Sampled by: ${pairedClock(port) || "(no clock)"}…`,
          act: () => pairMenu(ev, P, name),
        }
      : null,
    {
      label: "Move to the other side",
      act: () => flipPorts([{ P, port: name, isEdge }]),
    },
    {
      label: "Pick it (Shift+click) to move several",
      act: () => togglePick(P, name, isEdge),
    },
    {
      label: `Name${port.label ? ": " + trunc(port.label, 28) : ""}…`,
      act: () => editLabel(P, name),
    },
    {
      label: `Description${port.doc ? " ✓" : ""}…`,
      act: () =>
        editDoc(`Description of port ${P}.${name}`, () =>
          portsOfDef(P).find((p) => p.name === name),
        ),
    },
    {
      label: "Rename (VHDL name)…",
      act: () => {
        const n = askName("Port name", name);
        if (n && n !== name) {
          if (portsOfDef(P).some((p) => p.name === n))
            alert(`${P} already has ${n}.`);
          else renamePort(P, name, n);
        }
      },
    },
    { sep: true },
    {
      label: `Delete (from ${P}, every instance)`,
      danger: true,
      act: () => deletePort(P, name),
    },
  ]);
}

// drops from the side panel
const canvas = $("canvas");
canvas.addEventListener("dragover", (e) => e.preventDefault());
canvas.addEventListener("drop", (e) => {
  e.preventDefault();
  const D = S.sheet;
  if (!D) return;
  const def = e.dataTransfer.getData("text/x-partdef");
  const pd = e.dataTransfer.getData("text/x-portdef");
  const target = document.elementFromPoint(e.clientX, e.clientY);
  if (pd && target) {
    if (target.dataset.port)
      setPortType(partType(D, target.dataset.part), target.dataset.port, pd);
    else if (target.dataset.edge) setPortType(D, target.dataset.edge, pd);
    else hint("Drop an interface onto a port.");
    return;
  }
  if (def)
    addComponent(
      D,
      columnAt(geometry(D), svgPoint(e).x),
      svgPoint(e).y,
      def,
      true,
    );
});
document.addEventListener("click", (e) => {
  if (!$("menu").contains(e.target)) hideMenu();
});
document.addEventListener("keydown", (e) => {
  if (["INPUT", "TEXTAREA"].includes(e.target.tagName) || $("textDlg").open)
    return; // typing, or a dialog is open
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if (
    mod &&
    (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))
  ) {
    e.preventDefault();
    redo();
  } else if (e.key === "Escape") {
    S.armed = null;
    S.sel = null;
    S.picked = [];
    S.armedNet = null;
    hideMenu();
    render();
    hint();
  } else if (!mod && !e.altKey && e.key.toLowerCase() === "f") {
    if (S.picked.length) {
      const l = S.picked;
      S.picked = [];
      flipPorts(l);
    } else if (S.sel) flipComponent(S.sheet, S.sel.name);
  } else if ((e.key === "Delete" || e.key === "Backspace") && S.sel) {
    e.preventDefault();
    deletePart(S.sheet, S.sel.name);
  } else if (e.altKey && e.key === "ArrowLeft") goBack();
  else if (mod && S.sel && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    e.preventDefault();
    moveColumn(S.sheet, S.sel.name, e.key === "ArrowLeft" ? -1 : 1);
  }
});
$("undo").onclick = undo;
$("redo").onclick = redo;
$("back").onclick = goBack;
$("checkBtn").onclick = check;
$("libFilter").oninput = renderSide;

// ------------------------------------------------------------------ start
(async function start() {
  const r = await fetch("/api/model");
  S.pkgs = (await r.json()).packages;
  for (const p of S.pkgs)
    S.saved[p.file] = {
      m: JSON.stringify(p.model),
      l: JSON.stringify(p.layout || null),
    };
  rebuildIndex();
  const want = decodeURIComponent(location.hash.slice(1));
  const sheets = Object.keys(S.defs)
    .filter((n) => S.defs[n].coll === "partDefs" && isSheet(n))
    .sort();
  const first = partDef(want)
    ? want
    : sheets.find((n) => ["Fpga", "FpgaPart"].includes(kindOf(n))) ||
      sheets[0] ||
      null;
  if (first) {
    S.sheet = first;
    settle(first);
  }
  render();
  setStatus("ready");
  hint();
  check();
})();
