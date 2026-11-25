/* HA 2: the clock tree and reset tree views (like HA 1's Chain diagram).
 *
 * Built from the clock nets of the open sheet (netsOf in app.js), which are
 * plain SysML binds and connects:
 *   input clocks (the sheet's own clock inputs)  ->  generators (blocks with a
 *   clock output, e.g. a PLL)  ->  ...  ->  the blocks they drive.
 * Columns are ranks: an input clock is rank 0; a generator sits one past the
 * deepest clock it uses; blocks that only consume clocks share the last
 * column. "Flatten hierarchy" looks inside subsystems (their own sheets), so a
 * clock generated three levels down shows where it really comes from.
 * Read-only: clock assignment stays on the sheets.
 */
'use strict';

const CT = { open: false, mode: 'clock', sysref: true, flatten: false };   // mode: 'clock' or 'reset'

function buildClockTree(D) {
  const cats = new Set(CT.mode === 'reset' ? ['reset'] : ['clock', ...(CT.sysref ? ['sysref'] : [])]);
  const nodes = new Map();          // id -> {id, kind, label, sub, ins: Map(port -> src), outs: Map(port -> info)}
  const edges = [];                 // {src: {node, port}, dst: {node, port}, cat, name, freq}
  const node = (id, kind, label, sub) => {
    if (!nodes.has(id)) nodes.set(id, { id, kind, label, sub, ins: new Map(), outs: new Map() });
    return nodes.get(id);
  };
  const freqOf = (Dx, end) => { const u = portUsage(Dx, end), f = u && u.redefines && u.redefines.frequency_hz; return typeof f === 'number' ? f : null; };

  // One sheet: `incoming` maps an edge port (a clock coming into this sheet) to the
  // source feeding it from outside. Returns the sources behind this sheet's
  // clock outputs (edge port -> source), so the level above can use them.
  function sheet(Dx, prefix, incoming, depth) {
    const { nets } = netsOf(Dx);
    const out = {};
    const inner = {};               // flattened part -> its sources by its output port
    const flat = (part) => CT.flatten && depth < 8 && (partDef(partType(Dx, part)).parts || []).length > 0;
    // flattened subsystems first, inputs resolved from this sheet's nets
    for (const p of partsOf(Dx)) {
      if (!flat(p.name)) continue;
      const P = short(p.type), inc = {};
      for (const n of nets) if (cats.has(n.cat)) for (const m of n.members)
        if (m.kind === 'part' && m.part === p.name && !n.sources.includes(m)) inc[m.port] = srcOf(n);
      inner[p.name] = sheet(P, `${prefix}${p.name}/`, inc, depth + 1);
    }
    function srcOf(n) {
      const s = n.src;
      if (!s) return null;
      if (s.kind === 'edge') {
        if (incoming && incoming[s.port] !== undefined) return incoming[s.port];
        const nd = node(`in:${prefix}${s.port}`, 'input', s.port, `${n.cat}${n.freq ? ' · ' + fmtHz(n.freq) : ''}`);
        nd.outs.set(s.port, { cat: n.cat, name: s.port, freq: n.freq });
        return { node: nd.id, port: s.port, cat: n.cat, name: `${prefix}${s.port}`, freq: n.freq };
      }
      if (inner[s.part]) return inner[s.part][s.port] || null;
      const nd = node(`b:${prefix}${s.part}`, 'block', `${prefix}${s.part}`, partType(Dx, s.part));
      const f = freqOf(Dx, s);
      nd.outs.set(s.port, { cat: n.cat, name: s.port, freq: f });
      return { node: nd.id, port: s.port, cat: n.cat, name: `${prefix}${s.part}.${s.port}`, freq: f };
    }
    for (const n of nets) {
      if (!cats.has(n.cat)) continue;
      const src = srcOf(n);
      for (const m of n.members) {
        if (n.sources.includes(m)) continue;
        if (m.kind === 'edge') { out[m.port] = src; continue; }          // leaves this sheet
        if (inner[m.part]) continue;                                    // handled inside
        const nd = node(`b:${prefix}${m.part}`, 'block', `${prefix}${m.part}`, partType(Dx, m.part));
        nd.ins.set(m.port, src);
        if (src) edges.push({ src: { node: src.node, port: src.port }, dst: { node: nd.id, port: m.port }, cat: n.cat, name: src.name, freq: src.freq });
      }
    }
    // a clock output of this sheet that nothing inside drives yet
    for (const n of nets) if (n.src && n.src.kind === 'part' && !inner[n.src.part] && cats.has(n.cat)) srcOf(n);
    return out;
  }
  const outs = sheet(D, '', null, 0);
  for (const [port, src] of Object.entries(outs)) {        // clocks leaving the top sheet
    if (!src) continue;
    const nd = node(`out:${port}`, 'output', port, 'leaves the sheet');
    nd.ins.set(port, src);
    edges.push({ src: { node: src.node, port: src.port }, dst: { node: nd.id, port }, cat: src.cat, name: src.name, freq: src.freq });
  }
  return { nodes: [...nodes.values()], edges };
}

function layoutClockTree(g) {
  const byId = new Map(g.nodes.map(n => [n.id, n]));
  const rank = new Map();
  const rankOf = (id, seen = new Set()) => {
    if (rank.has(id)) return rank.get(id);
    const n = byId.get(id);
    if (n.kind === 'input') { rank.set(id, 0); return 0; }
    if (seen.has(id)) return 1;                                     // a loop: break it
    seen.add(id);
    const srcs = g.edges.filter(e => e.dst.node === id).map(e => e.src.node);
    const r = srcs.length ? 1 + Math.max(...srcs.map(s => rankOf(s, seen))) : 1;
    rank.set(id, r);
    return r;
  };
  g.nodes.forEach(n => rankOf(n.id));
  // Clock tree: blocks that only use clocks share the last column (HA 1's rule), so the
  // generation chain reads left to right. Reset tree: every block stays at its depth,
  // so all the blocks one synchroniser resets line up. Clocks leaving the sheet: one past.
  const gens = g.nodes.filter(n => n.kind === 'block' && n.outs.size);
  const last = CT.mode === 'reset'
    ? Math.max(1, ...g.nodes.filter(n => n.kind === 'block').map(n => rank.get(n.id)))
    : Math.max(1, ...gens.map(n => rank.get(n.id) + 1));
  for (const n of g.nodes) {
    if (CT.mode !== 'reset' && n.kind === 'block' && !n.outs.size) rank.set(n.id, last);
    if (n.kind === 'output') rank.set(n.id, last + 1);
  }
  // rows: column by column, ordered by where their clocks come from
  const cols = new Map();
  for (const n of g.nodes) { const r = rank.get(n.id); if (!cols.has(r)) cols.set(r, []); cols.get(r).push(n); }
  const pos = new Map(), W = 190, GAP = 120, X0 = 20, Y0 = 50, VGAP = 18;
  const ranks = [...cols.keys()].sort((a, b) => a - b);
  const heightOf = (n) => 34 + 20 * Math.max(1, n.ins.size, n.outs.size);
  const portY = (n, side, port) => { const keys = [...(side === 'in' ? n.ins : n.outs).keys()]; return 34 + 20 * keys.indexOf(port) + 4; };
  ranks.forEach((r, ci) => {
    const col = cols.get(r);
    const key = (n) => {
      const ys = g.edges.filter(e => e.dst.node === n.id && pos.has(e.src.node)).map(e => pos.get(e.src.node).y + portY(byId.get(e.src.node), 'out', e.src.port));
      return ys.length ? Math.min(...ys) : 0;
    };
    col.sort((a, b) => key(a) - key(b) || a.label.localeCompare(b.label));
    let y = Y0;
    for (const n of col) { pos.set(n.id, { x: X0 + ci * (W + GAP), y, w: W, h: heightOf(n) }); y += heightOf(n) + VGAP; }
  });
  return { pos, portY, W, GAP, X0, colOf: (id) => Math.round((pos.get(id).x - X0) / (W + GAP)), cols, ranks, width: X0 * 2 + ranks.length * (W + GAP), height: Math.max(200, ...[...pos.values()].map(p => p.y + p.h)) + 40 };
}

function renderClockTree() {
  const D = S.sheet, box = document.getElementById('ctSvg');
  box.innerHTML = '';
  if (!D || !partDef(D)) return;
  const g = buildClockTree(D), L = layoutClockTree(g);
  const byId = new Map(g.nodes.map(n => [n.id, n]));
  box.setAttribute('width', L.width); box.setAttribute('height', L.height);
  document.getElementById('ctTitle').textContent = `${CT.mode === 'reset' ? 'Reset' : 'Clock'} tree: ${D}`;
  document.getElementById('ctSysrefL').hidden = CT.mode === 'reset';
  if (!g.nodes.length) { el('text', { x: 20, y: 40 }, box, CT.mode === 'reset' ? 'No resets on this sheet yet.' : 'No clocks on this sheet yet.'); return; }
  // colours: one per source (an input clock or a generated clock)
  const srcKeys = [...new Set(g.edges.map(e => `${e.src.node}|${e.src.port}`))];
  const colorOf = (k) => NET_COLORS[srcKeys.indexOf(k) % NET_COLORS.length];
  // Routing: every line runs in the gaps between columns, never behind a box.
  // In a gap each source gets its own vertical lane; a line that skips columns
  // crosses them at a height that is free in every one of them.
  const gapX = (c) => L.X0 + c * (L.W + L.GAP) + L.W;           // the gap after column c starts here
  const lanes = new Map(), laneCount = new Map();
  const lane = (c, k) => {
    const key = `${c}|${k}`;
    if (!lanes.has(key)) { const n = laneCount.get(c) || 0; laneCount.set(c, n + 1); lanes.set(key, gapX(c) + 14 + (n * 9) % (L.GAP - 28)); }
    return lanes.get(key);
  };
  const boxesIn = (c0, c1) => [...L.pos.entries()].filter(([id]) => { const c = L.colOf(id); return c >= c0 && c <= c1; }).map(([, p]) => p);
  const freeY = (c0, c1, want) => {
    const boxes = boxesIn(c0, c1);
    const blocked = (y) => boxes.some(b => y > b.y - 5 && y < b.y + b.h + 5);
    const cands = [want, ...boxes.flatMap(b => [b.y - 9, b.y + b.h + 9])].filter(y => y > 10);
    cands.sort((a, b) => Math.abs(a - want) - Math.abs(b - want));
    let y = cands.find(y => !blocked(y)) ?? Math.max(...boxes.map(b => b.y + b.h)) + 14;
    for (let i = 0; i < 6 && usedY.some(u => Math.abs(u - y) < 4); i++)   // keep crossing lines apart
      if (!blocked(y + 5)) y += 5; else if (!blocked(y - 5)) y -= 5; else break;
    usedY.push(y);
    return y;
  };
  const usedY = [];
  for (const e of g.edges) {
    const a = L.pos.get(e.src.node), b = L.pos.get(e.dst.node);
    if (!a || !b) continue;
    const k = `${e.src.node}|${e.src.port}`, col = colorOf(k);
    const y1 = a.y + L.portY(byId.get(e.src.node), 'out', e.src.port), y2 = b.y + L.portY(byId.get(e.dst.node), 'in', e.dst.port);
    const ca = L.colOf(e.src.node), cb = L.colOf(e.dst.node), x1 = a.x + a.w, x2 = b.x;
    let d;
    if (cb === ca + 1) d = `M${x1},${y1} H${lane(ca, k)} V${y2} H${x2}`;
    else if (cb > ca + 1) {
      const yc = freeY(ca + 1, cb - 1, y2);
      d = `M${x1},${y1} H${lane(ca, k)} V${yc} H${lane(cb - 1, k)} V${y2} H${x2}`;
    } else {                                                      // backwards (a loop): round the bottom
      const yb = Math.max(...[...L.pos.values()].map(p => p.y + p.h)) + 16;
      d = `M${x1},${y1} H${x1 + 10} V${yb} H${x2 - 10} V${y2} H${x2}`;
    }
    const p = el('path', { d, class: 'ct-edge' + (e.cat === 'reset' ? ' reset' : e.cat === 'sysref' ? ' sysref' : ''), style: `stroke:${col}` }, box);
    tip(p, `${e.name}${e.freq ? ' · ' + fmtHz(e.freq) : ''} (${e.cat})`);
    el('path', { d: `M${x2 - 6},${y2 - 4} L${x2},${y2} L${x2 - 6},${y2 + 4}`, style: `stroke:${col};fill:none;stroke-width:1.5` }, box);
  }
  for (const n of g.nodes) {
    const p = L.pos.get(n.id);
    const kind = n.kind === 'block' ? kindOf(n.sub) : null;
    const fill = n.kind === 'input' ? '#e9edf3' : n.kind === 'output' ? '#f3ede9' : (KIND_COLORS[kind] || '#6b7280');
    const on = n.kind === 'block' ? 'on-kind' : '';
    const r = el('rect', { x: p.x, y: p.y, width: p.w, height: p.h, rx: 4, class: 'ct-node', style: `fill:${fill}` }, box);
    tip(r, n.kind === 'block' ? `${n.label} : ${n.sub}${n.outs.size ? '\ngenerates clocks' : ''}` : `${n.label} (${n.sub})`);
    el('text', { x: p.x + p.w / 2, y: p.y + 16, 'text-anchor': 'middle', class: 'comp-name ' + on }, box, trunc(n.label, 26));
    el('text', { x: p.x + p.w / 2, y: p.y + 29, 'text-anchor': 'middle', class: 'comp-type ' + on }, box, trunc(n.kind === 'block' ? `${n.sub}${n.outs.size ? ' · generator' : ''}` : n.sub, 30));
    let i = 0;
    for (const [port] of n.ins) el('text', { x: p.x + 6, y: p.y + L.portY(n, 'in', port) + 4, class: 'port-label ' + on }, box, trunc(port, 14)), i++;
    for (const [port, info] of n.outs) {
      if (n.kind === 'input') continue;
      el('text', { x: p.x + p.w - 6, y: p.y + L.portY(n, 'out', port) + 4, 'text-anchor': 'end', class: 'port-label ' + on }, box,
        trunc(`${port}${info.freq ? ' ' + fmtHz(info.freq) : ''}`, 18));
    }
  }
}

function openClockTree(mode) {
  CT.open = true;
  CT.mode = mode || 'clock';
  document.getElementById('clockTree').hidden = false;
  renderClockTree();
}
function closeClockTree() { CT.open = false; document.getElementById('clockTree').hidden = true; }

document.getElementById('clockTreeBtn').onclick = () => openClockTree('clock');
document.getElementById('resetTreeBtn').onclick = () => openClockTree('reset');
document.getElementById('ctClose').onclick = closeClockTree;
for (const [id, key] of [['ctSysref', 'sysref'], ['ctFlatten', 'flatten']]) {
  const cb = document.getElementById(id);
  cb.checked = CT[key];
  cb.onchange = () => { CT[key] = cb.checked; renderClockTree(); };
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && CT.open) closeClockTree(); });
