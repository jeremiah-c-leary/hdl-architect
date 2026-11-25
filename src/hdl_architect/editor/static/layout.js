// HA 2: Where things are: the layout sidecar, settling, geometry.
import { G } from "./state.js";
import {
  endStr,
  partDef,
  partType,
  partsOf,
  pkgOf,
  portsOfDef,
  short,
  wiresOf,
} from "./model.js";
import { drawnWires } from "./nets.js";

// ------------------------------------------------------------------ layout
export function layoutOf(pkg) {
  if (!pkg.layout) pkg.layout = { layoutVersion: 1, sheets: {}, ports: {} };
  pkg.layout.sheets = pkg.layout.sheets || {};
  pkg.layout.ports = pkg.layout.ports || {};
  return pkg.layout;
}
export function sheetLayout(D) {
  const L = layoutOf(pkgOf(D));
  return L.sheets[D] || (L.sheets[D] = { columns: 0, parts: {}, edge: {} });
}
export function portLayout(P, port) {
  const L = layoutOf(pkgOf(P));
  const m = L.ports[P] || (L.ports[P] = {});
  return m[port] || (m[port] = { side: "left", offset: G.PMT });
}
export function hasPortLayout(P, port) {
  const L = layoutOf(pkgOf(P));
  return !!(L.ports[P] && L.ports[P][port]);
}

export function ensureLayout(D) {
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

export function fitHeights(D) {
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
export function resolveOverlaps(D, componentsOnly) {
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
export function setAbsY(D, end, y) {
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
export function settle(D) {
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
export function geometry(D) {
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
export function absPort(D, geo, end) {
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
export function columnAt(geo, x) {
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
