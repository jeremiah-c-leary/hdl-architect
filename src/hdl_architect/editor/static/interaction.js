// HA 2: Mouse, drag and drop, and keyboard.
import { G, editor } from "./state.js";
import { $ } from "./svg.js";
import { showDefaultHint, showHint } from "./statusbar.js";
import { endStr, isSheet, partDef, partType, portsOfDef } from "./model.js";
import {
  assignNet,
  drawnWires,
  globalInfo,
  netMenu,
  netsOf,
  retypeAndAssign,
} from "./nets.js";
import {
  absPort,
  columnAt,
  fitHeights,
  geometry,
  layOutSheet,
  portLayout,
  setAbsY,
  sheetLayout,
} from "./layout.js";
import { changed, redo, snapshot, undo } from "./store.js";
import {
  addComponent,
  connectArmed,
  connectPorts,
  deletePart,
  flipComponent,
  flipPorts,
  isPicked,
  moveColumn,
  quickConnect,
  setPortType,
  togglePick,
} from "./edits.js";
import { hideMenu } from "./menus.js";
import { render } from "./render.js";

// ------------------------------------------------------------------ interaction
export function openSheet(n) {
  if (!partDef(n)) return;
  if (
    !isSheet(n) &&
    !confirm(`${n} has no parts yet. Open it as a sheet to add some?`)
  )
    return;
  if (editor.sheet && editor.sheet !== n) editor.back.push(editor.sheet);
  editor.sheet = n;
  editor.sel = null;
  editor.armed = null;
  history.replaceState(null, "", "#" + n);
  layOutSheet(n);
  render();
  showDefaultHint();
}
export function goBack() {
  const b = editor.back.pop();
  if (b && partDef(b)) {
    editor.sheet = b;
    editor.sel = null;
    editor.armed = null;
    history.replaceState(null, "", "#" + b);
    layOutSheet(b);
    render();
  }
}
export function svgPoint(ev) {
  const r = $("canvas").getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}

export function startDrag(ev, what) {
  if (ev.button !== 0) return;
  ev.stopPropagation();
  editor.drag = Object.assign(
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
  const d = editor.drag;
  if (!d) return;
  const dx = ev.clientX - d.x0,
    dy = ev.clientY - d.y0m;
  if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
  d.moved = true;
  const D = editor.sheet,
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
  if (editor.band) {
    // Shift+drag along an edge: pick every port in the range
    const b = editor.band,
      y1 = svgPoint(ev).y,
      lo = Math.min(b.y0, y1) - 6,
      hi = Math.max(b.y0, y1) + 6;
    editor.band = null;
    const D = editor.sheet,
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
        editor.picked.push({ P: D, port: p.name, isEdge: true });
    }
    render();
    showHint(
      editor.picked.length
        ? `${editor.picked.length} port(s) picked: press F (or right-click one) to move them to the other side. Esc clears.`
        : "",
    );
    return;
  }
  const d = editor.drag;
  if (!d) return;
  editor.drag = null;
  if (d.moved) {
    // a move: one undo step, then lay the sheet out
    editor.undo.push(d.snap);
    editor.redo = [];
    // dragging a port, or a component's top past its ports, moves ports: their
    // wire partners follow them (otherwise settling would pull them back)
    const moved =
      d.kind === "port"
        ? [d.port]
        : d.kind === "resizeTop"
          ? Object.keys(d.offs).filter(
              (n) =>
                sheetLayout(editor.sheet).parts[d.part].y +
                  portLayout(d.P, n).offset !==
                d.y0 + d.offs[n],
            )
          : [];
    for (const port of moved) {
      const D = editor.sheet;
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
    if (editor.armed) {
      connectArmed({ part: d.part });
      return;
    }
    if (!d.ctrl && takesPartClick(d.part, ev)) return;
    if (
      d.ctrl &&
      editor.sel &&
      editor.sel.kind === "part" &&
      editor.sel.name !== d.part
    ) {
      const a = editor.sel.name;
      editor.sel = null;
      quickConnect(a, d.part);
      return;
    }
    editor.sel =
      editor.sel && editor.sel.name === d.part
        ? null
        : { kind: "part", name: d.part };
    render();
    showHint(
      editor.sel
        ? `Selected ${d.part}. Ctrl+click another component to connect them; F flips it; Ctrl+←/→ moves it a column; Delete removes it.`
        : "",
    );
  } else if (
    (d.kind === "port" || d.kind === "edge") &&
    !d.shift &&
    editor.armed &&
    endStr(editor.armed) !==
      endStr(
        d.kind === "edge"
          ? { kind: "edge", port: d.port }
          : { kind: "part", part: d.part, port: d.port },
      )
  ) {
    connectPorts(
      editor.armed,
      d.kind === "edge"
        ? { kind: "edge", port: d.port }
        : { kind: "part", part: d.part, port: d.port },
    );
  } else if (
    (d.kind === "port" || d.kind === "edge") &&
    !d.shift &&
    !editor.armed &&
    globalInfo(
      editor.sheet,
      d.kind === "edge"
        ? { kind: "edge", port: d.port }
        : { kind: "part", part: d.part, port: d.port },
    )
  ) {
    const D = editor.sheet,
      end =
        d.kind === "edge"
          ? { kind: "edge", port: d.port }
          : { kind: "part", part: d.part, port: d.port };
    const info = globalInfo(D, end),
      { nets, byEnd } = netsOf(D);
    const armedNet =
      editor.armedNet && nets.find((n) => n.name === editor.armedNet);
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
      showHint(
        `${endStr(end)} drives a net itself, so it cannot go on ${armedNet.name}.`,
      );
    else netMenu(ev, D, end);
  } else if (
    (d.kind === "port" || d.kind === "edge") &&
    !d.shift &&
    !editor.armed &&
    takesPortClick(d)
  ) {
    // the walk took it: the sheet port it starts at
  } else if ((d.kind === "port" || d.kind === "edge") && d.shift) {
    togglePick(
      d.kind === "edge" ? editor.sheet : d.P,
      d.port,
      d.kind === "edge",
    );
  } else if (d.kind === "port" || d.kind === "edge") {
    const end =
      d.kind === "edge"
        ? { kind: "edge", port: d.port }
        : { kind: "part", part: d.part, port: d.port };
    editor.armed =
      editor.armed && endStr(editor.armed) === endStr(end) ? null : end;
    render();
    showHint(
      editor.armed
        ? `Wiring ${endStr(end)}: click another port to wire the two, or a component (new port + wire)${end.kind === "part" ? " or a sheet edge (new sheet port + bind)" : ""}. Esc cancels.`
        : "",
    );
  }
});
/** Who else wants a click on a port or a part (the walk, while the dock is open). */
let portClickTaker = null;
let partClickTaker = null;

/** `taker(end)` sees each plain click on a port first; true: it took it. */
export function onPortClick(taker) {
  portClickTaker = taker;
}

/** `taker(partName, event)` sees each plain click on a part first; true: it took it. */
export function onPartClick(taker) {
  partClickTaker = taker;
}

function takesPartClick(partName, event) {
  if (!partClickTaker) return false;
  return partClickTaker(partName, event);
}

function takesPortClick(drag) {
  if (!portClickTaker) return false;
  const end =
    drag.kind === "edge"
      ? { kind: "edge", port: drag.port }
      : { kind: "part", part: drag.part, port: drag.port };
  return portClickTaker(end);
}

export function edgeClick(ev, side) {
  if (editor.armed && editor.armed.kind === "part")
    connectArmed({ edge: side, y: svgPoint(ev).y });
}

// drops from the side panel
export const canvas = $("canvas");
canvas.addEventListener("dragover", (e) => e.preventDefault());
canvas.addEventListener("drop", (e) => {
  e.preventDefault();
  const D = editor.sheet;
  if (!D) return;
  const def = e.dataTransfer.getData("text/x-partdef");
  const pd = e.dataTransfer.getData("text/x-portdef");
  const target = document.elementFromPoint(e.clientX, e.clientY);
  if (pd && target) {
    if (target.dataset.port)
      setPortType(partType(D, target.dataset.part), target.dataset.port, pd);
    else if (target.dataset.edge) setPortType(D, target.dataset.edge, pd);
    else showHint("Drop an interface onto a port.");
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
    editor.armed = null;
    editor.sel = null;
    editor.picked = [];
    editor.armedNet = null;
    hideMenu();
    render();
    showDefaultHint();
  } else if (!mod && !e.altKey && e.key.toLowerCase() === "f") {
    if (editor.picked.length) {
      const l = editor.picked;
      editor.picked = [];
      flipPorts(l);
    } else if (editor.sel) flipComponent(editor.sheet, editor.sel.name);
  } else if ((e.key === "Delete" || e.key === "Backspace") && editor.sel) {
    e.preventDefault();
    deletePart(editor.sheet, editor.sel.name);
  } else if (e.altKey && e.key === "ArrowLeft") goBack();
  else if (
    mod &&
    editor.sel &&
    (e.key === "ArrowLeft" || e.key === "ArrowRight")
  ) {
    e.preventDefault();
    moveColumn(editor.sheet, editor.sel.name, e.key === "ArrowLeft" ? -1 : 1);
  }
});
