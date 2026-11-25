// HA 2: Editing operations on the model and its layout.
import { COLLS, G, S } from "./state.js";
import { askName, hint, pascal, snake } from "./util.js";
import {
  counterpart,
  endStr,
  ensureImport,
  partDef,
  partType,
  partsOf,
  pkgOf,
  portsOfDef,
  rebuildIndex,
  short,
} from "./model.js";
import { drawnWires, portUsage } from "./nets.js";
import { hasPortLayout, layoutOf, portLayout, sheetLayout } from "./layout.js";
import {
  changed,
  flushSave,
  mutate,
  runOp,
  snapshot,
  takeChanged,
} from "./store.js";
import { render } from "./render.js";

// ------------------------------------------------------------------ edits
export function uniquePortName(P, base) {
  const names = new Set(portsOfDef(P).map((p) => p.name));
  let n = base,
    i = 2;
  while (names.has(n)) n = `${base}_${i++}`;
  return n;
}
export function uniqueDefName(base) {
  let n = base,
    i = 2;
  while (S.defs[n]) n = `${base}${i++}`;
  return n;
}
export function uniquePartName(D, base) {
  const names = new Set(partsOf(D).map((p) => p.name));
  let n = base,
    i = 2;
  while (names.has(n)) n = `${base}_${i++}`;
  return n;
}
export function addPort(P, name, type, side, offset) {
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
export function quickConnect(a, b) {
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
export function connectArmed(target) {
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
export async function connectPorts(a, b) {
  // The model rules (ports exist, interfaces fit, untyped ends take the
  // matching role, no duplicate wire, clocks/resets/SYSREF are nets) are a
  // model operation in Python (core.ops.connect, via the server). The drawing
  // rules stay here: two components in one column cannot be wired, and ports
  // turn to face their wire.
  const D = S.sheet,
    sl = sheetLayout(D);
  S.armed = null;
  const say = (msg) => {
    render();
    hint(msg);
  };
  const isBind = a.kind === "edge" || b.kind === "edge";
  if (
    !isBind &&
    a.part !== b.part &&
    sl.parts[a.part].col === sl.parts[b.part].col
  )
    return say("Same column: move one of them first.");
  // a connect is written left component first (the end that anchors the wire)
  const [first, second] =
    !isBind && sl.parts[a.part].col > sl.parts[b.part].col ? [b, a] : [a, b];
  const owner = (e) => (e.kind === "edge" ? D : partType(D, e.part));
  const wiredElsewhere = (e) =>
    drawnWires(D).some(
      (w) => endStr(w.a) === endStr(e) || endStr(w.b) === endStr(e),
    );
  const before = { a: wiredElsewhere(a), b: wiredElsewhere(b) };
  const snap = snapshot();
  if (!(await flushSave()))
    return say("Not wired: save the open changes first.");
  const res = await runOp("connect", {
    sheet: D,
    a: endStr(first),
    b: endStr(second),
  });
  if (res.error) {
    if (res.error.code === "interfaces") alert(res.error.message);
    return say(res.error.code === "interfaces" ? "" : res.error.message);
  }
  takeChanged(res.changed);
  const turned = [];
  const face = (e, side, wasWired) => {
    // turn a component port to `side` if nothing else was wired to it
    if (
      e.kind !== "part" ||
      portLayout(owner(e), e.port).side === side ||
      wasWired
    )
      return;
    setPortSide(owner(e), e.port, side);
    turned.push(endStr(e));
  };
  const wired = (e) => (e === a ? before.a : before.b);
  if (isBind) {
    const edge = a.kind === "edge" ? a : b,
      part = a.kind === "edge" ? b : a;
    if (!wired(edge))
      sl.edge[edge.port].side =
        sl.parts[part.part].col >= sl.columns / 2 ? "right" : "left";
    face(part, sl.edge[edge.port].side, wired(part));
  } else {
    face(first, "right", wired(first));
    face(second, "left", wired(second));
  }
  S.undo.push(snap);
  if (S.undo.length > 200) S.undo.shift();
  S.redo = [];
  changed();
  hint(
    `Wired ${endStr(a)} ${isBind ? "=" : "–"} ${endStr(b)}.` +
      (turned.length ? ` Turned ${turned.join(", ")} to face the wire.` : ""),
  );
}
export function addComponent(D, col, y, kindOrDef, isDef) {
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
export function renamePart(D, old, nu) {
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
export function renamePort(P, old, nu) {
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
export function renameDef(old, nu) {
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
export function deletePart(D, name) {
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
export function deletePort(P, name) {
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
export function deleteWire(D, w) {
  mutate(() => {
    const d = partDef(D),
      k = w.kind === "connect" ? "connections" : "bindings";
    d[k].splice(w.idx, 1);
    if (!d[k].length) delete d[k];
  });
}
export function typePort(P, name, type) {
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
export function setPortType(P, name, type) {
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
export function insertColumn(D, at) {
  mutate(() => {
    const sl = sheetLayout(D);
    for (const q of Object.values(sl.parts)) if (q.col >= at) q.col++;
    sl.columns++;
  });
}
export function otherSide(s) {
  return s === "left" ? "right" : "left";
}
export function setPortSide(P, port, side) {
  // one side per port of a part def: on every instance of it, and on its own sheet's edge (as in HA 1)
  portLayout(P, port).side = side;
  const sl = layoutOf(pkgOf(P)).sheets[P];
  if (sl && sl.edge[port]) sl.edge[port].side = side;
}
export function sideOf(P, port, isEdge) {
  return isEdge ? sheetLayout(P).edge[port].side : portLayout(P, port).side;
}
export function flipPorts(list) {
  // list: [{P, port, isEdge}]
  mutate(() => {
    for (const x of list)
      setPortSide(x.P, x.port, otherSide(sideOf(x.P, x.port, x.isEdge)));
  });
}
export function flipComponent(D, name) {
  const P = partType(D, name);
  flipPorts(portsOfDef(P).map((p) => ({ P, port: p.name, isEdge: false })));
  hint(
    `Flipped ${name}: its ports swapped sides (on every instance of ${P}, and on ${P}'s own sheet).`,
  );
}
export const pickKey = (P, port) => `${P}.${port}`;
export function isPicked(P, port) {
  return S.picked.some((x) => pickKey(x.P, x.port) === pickKey(P, port));
}
export function togglePick(P, port, isEdge) {
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
export function moveColumn(D, name, by) {
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
export function removeColumn(D, c) {
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
