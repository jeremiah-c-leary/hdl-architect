// HA 2: Editing operations on the model and its layout.
import { G, editor } from "./state.js";
import { showHint } from "./statusbar.js";
import { askName } from "./dialogs.js";
import {
  endStr,
  partDef,
  partType,
  partsOf,
  pkgOf,
  portsOfDef,
} from "./model.js";
import { drawnWires } from "./nets.js";
import { hasPortLayout, layoutOf, portLayout, sheetLayout } from "./layout.js";
import { applyOp, mutate } from "./store.js";
import { render } from "./render.js";

// ------------------------------------------------------------------ edits
export function uniquePortName(P, base) {
  const names = new Set(portsOfDef(P).map((p) => p.name));
  let n = base,
    i = 2;
  while (names.has(n)) n = `${base}_${i++}`;
  return n;
}
export function uniquePartName(D, base) {
  const names = new Set(partsOf(D).map((p) => p.name));
  let n = base,
    i = 2;
  while (names.has(n)) n = `${base}_${i++}`;
  return n;
}
/** Where a new port is drawn: on `side`, below the ports already there. */
export function placePort(P, name, side, offset) {
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
// "New port + wire" gestures: a model operation (core.ops.connect_new, via the
// server) adds the port(s) and wires them with connect's rules (a new port
// takes the matching interface). The browser keeps the drawing rules: no
// wire within one column, and where the new ports are drawn.

/** Ctrl+click two components: a new port on each, named after the other, wired. */
export async function quickConnect(a, b) {
  const D = editor.sheet,
    sl = sheetLayout(D);
  if (sl.parts[a].col === sl.parts[b].col) {
    showHint(
      `${a} and ${b} are in the same column: there is no gutter for a horizontal wire (maybe a level of hierarchy is missing). Move one to another column.`,
    );
    return;
  }
  // the left component's end first (the end that anchors the wire)
  const [l, r] = sl.parts[a].col < sl.parts[b].col ? [a, b] : [b, a];
  const res = await applyOp(
    "connect_new",
    { sheet: D, a: { new: l, name: r }, b: { new: r, name: l } },
    (res) => {
      placePort(partType(D, l), res.data.a, "right");
      placePort(partType(D, r), res.data.b, "left");
    },
  );
  if (res)
    showHint(
      `Connected ${a} and ${b}. Right-click a port to give it an interface.`,
    );
}

/** Click a port, then a component (a new port there) or the sheet edge (a new sheet port). */
export async function connectArmed(target) {
  // target: a part name on this sheet, or {edge:'left'|'right', y}
  const D = editor.sheet,
    sl = sheetLayout(D),
    armed = editor.armed;
  editor.armed = null;
  const armedPort =
    armed.kind === "edge"
      ? portsOfDef(D).find((p) => p.name === armed.port)
      : portsOfDef(partType(D, armed.part)).find((p) => p.name === armed.port);
  if (!armedPort) {
    render();
    return;
  }
  if (target.edge) {
    if (armed.kind !== "part") return render(); // a sheet port to the edge: nothing to do
    // a new sheet port on the clicked edge, bound to the armed component port
    await applyOp(
      "connect_new",
      { sheet: D, a: { new: null, name: armed.port }, b: endStr(armed) },
      (res) => {
        const ys = Object.values(sl.edge)
          .filter((e) => e.side === target.edge)
          .map((e) => e.y);
        sl.edge[res.data.a] = {
          side: target.edge,
          y:
            target.y || (ys.length ? Math.max(...ys) + G.PGAP : G.TOP + G.PGAP),
        };
      },
    );
    return;
  }
  const part = target.part,
    P = partType(D, part);
  if (armed.kind === "part" && armed.part === part) return render();
  if (armed.kind === "edge") {
    // the sheet port moves to the edge nearer the component, so the wire need not cross the sheet
    const side = sl.parts[part].col >= sl.columns / 2 ? "right" : "left";
    await applyOp(
      "connect_new",
      { sheet: D, a: armed.port, b: { new: part, name: armed.port } },
      (res) => {
        sl.edge[armed.port].side = side;
        placePort(P, res.data.b, side);
      },
    );
    return;
  }
  if (sl.parts[armed.part].col === sl.parts[part].col) {
    showHint("Same column: move one of them first.");
    return render();
  }
  const aLeft = sl.parts[armed.part].col < sl.parts[part].col;
  const mine = endStr(armed),
    fresh = { new: part, name: armed.part };
  await applyOp(
    "connect_new",
    { sheet: D, a: aLeft ? mine : fresh, b: aLeft ? fresh : mine },
    (res) =>
      placePort(P, aLeft ? res.data.b : res.data.a, aLeft ? "left" : "right"),
  );
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
  const D = editor.sheet,
    sl = sheetLayout(D);
  editor.armed = null;
  const say = (msg) => {
    render();
    showHint(msg);
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
  const wired = (e) => (e === a ? before.a : before.b);
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
  const res = await applyOp(
    "connect",
    { sheet: D, a: endStr(first), b: endStr(second) },
    () => {
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
    },
  );
  if (res)
    showHint(
      `Wired ${endStr(a)} ${isBind ? "=" : "–"} ${endStr(b)}.` +
        (turned.length ? ` Turned ${turned.join(", ")} to face the wire.` : ""),
    );
}
export function addComponent(D, col, y, kindOrDef, isDef) {
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
  // core.ops.add_part: a new part def of the kind (named after the part), or
  // an instance of an existing def; the browser places it in the column
  return applyOp(
    "add_part",
    isDef
      ? { sheet: D, name, def: kindOrDef }
      : { sheet: D, name, kind: kindOrDef },
    () => {
      sheetLayout(D).parts[name] = {
        col,
        y: Math.max(G.TOP + 10, y),
        h: G.MINH,
      };
    },
  );
}
// Parts and definitions are model operations (core.ops: rename_part,
// delete_part, rename_def, set_part_def, set_kind): the references follow.
// The browser moves or removes their layout entries.
export function renamePart(D, old, nu) {
  return applyOp("rename_part", { sheet: D, old, new: nu }, () => {
    const sl = sheetLayout(D);
    sl.parts[nu] = sl.parts[old];
    delete sl.parts[old];
  });
}
// Ports are model operations (core.ops: add_port, rename_port, delete_port,
// via the server): the wires and clock pairings that refer to a port follow
// it. The browser only moves or removes the port's place in the layout.
export function renamePort(P, old, nu) {
  return applyOp("rename_port", { def: P, old, new: nu }, () => {
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
  const L = layoutOf(pkgOf(old));
  return applyOp("rename_def", { old, new: nu }, () => {
    if (L.sheets[old]) {
      L.sheets[nu] = L.sheets[old];
      delete L.sheets[old];
    }
    if (L.ports[old]) {
      L.ports[nu] = L.ports[old];
      delete L.ports[old];
    }
    if (editor.sheet === old) editor.sheet = nu;
    editor.back = editor.back.map((b) => (b === old ? nu : b));
  });
}
export function deletePart(D, name) {
  return applyOp("delete_part", { sheet: D, name }, () => {
    delete sheetLayout(D).parts[name];
    if (editor.sel && editor.sel.name === name) editor.sel = null;
  });
}
export function setPartDef(D, part, def) {
  return applyOp("set_part_def", { sheet: D, part, def });
}
export function setKind(P, kind) {
  return applyOp("set_kind", { def: P, kind });
}
export function deletePort(P, name) {
  return applyOp("delete_port", { def: P, port: name }, () => {
    const L = layoutOf(pkgOf(P));
    if (L.ports[P]) delete L.ports[P][name];
    if (L.sheets[P]) delete L.sheets[P].edge[name];
  });
}
/** A new port of the sheet itself, drawn on its `side` edge at height `y`. */
export function newSheetPort(D, name, side, y) {
  return applyOp("add_port", { def: D, name }, (res) => {
    sheetLayout(D).edge[res.data.name] = { side, y };
  });
}
export function newPort(P, name, side) {
  return applyOp("add_port", { def: P, name }, (res) =>
    placePort(P, res.data.name, side),
  );
}
export function deleteWire(D, w) {
  return applyOp("delete_wire", { sheet: D, a: endStr(w.a), b: endStr(w.b) });
}
// A port's interface is a model operation (core.ops.set_interface, via the
// server): it also gives an untyped port at the other end of a wire on the
// open sheet the matching interface.
export function setPortType(P, name, type) {
  return setPortsType([{ P, port: name }], type);
}
export function setPortsType(list, type) {
  const D = editor.sheet && partDef(editor.sheet) ? editor.sheet : null;
  return applyOp("set_interface", {
    sheet: D,
    ports: list.map((x) => ({ def: x.P, port: x.port })),
    type: type || null,
  });
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
  showHint(
    `Flipped ${name}: its ports swapped sides (on every instance of ${P}, and on ${P}'s own sheet).`,
  );
}
export const pickKey = (P, port) => `${P}.${port}`;
export function isPicked(P, port) {
  return editor.picked.some((x) => pickKey(x.P, x.port) === pickKey(P, port));
}
export function togglePick(P, port, isEdge) {
  if (isPicked(P, port))
    editor.picked = editor.picked.filter(
      (x) => pickKey(x.P, x.port) !== pickKey(P, port),
    );
  else editor.picked.push({ P, port, isEdge });
  render();
  showHint(
    editor.picked.length
      ? `${editor.picked.length} port(s) picked: press F (or right-click one) to move them to the other side. Esc clears.`
      : "",
  );
}
export function moveColumn(D, name, by) {
  const sl = sheetLayout(D),
    q = sl.parts[name],
    to = q.col + by;
  if (to < 0 || to >= sl.columns) {
    showHint(`No column there: right-click a gutter to add one.`);
    return;
  }
  mutate(() => {
    q.col = to;
  });
}
export function removeColumn(D, c) {
  const sl = sheetLayout(D);
  if (Object.values(sl.parts).some((q) => q.col === c)) {
    showHint("Only an empty column can be removed.");
    return;
  }
  mutate(() => {
    for (const q of Object.values(sl.parts)) if (q.col > c) q.col--;
    sl.columns = Math.max(1, sl.columns - 1);
  });
}
export function snake(s) {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}
