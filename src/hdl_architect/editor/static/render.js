// HA 2: Drawing a sheet, the side panel and the problem list.
import { G, KIND_COLORS, S } from "./state.js";
import { $, el, tip, trunc } from "./svg.js";
import {
  brokenEnds,
  counterpart,
  endStr,
  isSheet,
  kindOf,
  partDef,
  partType,
  partsOf,
  pkgOf,
  portDef,
  portsOfDef,
  short,
  shown,
  wiresOf,
} from "./model.js";
import {
  armNet,
  catOfUsage,
  drawnWires,
  fmtHz,
  globalEnds,
  globalInfo,
  isAsyncReset,
  needsPair,
  netTiming,
  netsOf,
  pairMenu,
  pairable,
  pairedClock,
  portUsage,
  setNetFrequency,
} from "./nets.js";
import { absPort, geometry, portLayout, sheetLayout } from "./layout.js";
import { deleteWire, insertColumn, isPicked } from "./edits.js";
import { colMenu, compMenu, edgeMenu, menu, portMenu } from "./menus.js";
import { edgeClick, openSheet, startDrag, svgPoint } from "./interaction.js";
import { CT, renderClockTree } from "./clocktree.js";

// ------------------------------------------------------------------ render
export function render() {
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
export function renderSide() {
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
export function renderNets() {
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
export function renderCrumbs() {
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
export function renderProblems() {
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
