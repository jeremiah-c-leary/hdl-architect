// HA 2: The context menu, every right-click menu, and the text dialogs.
import { KIND_COLORS, S } from "./state.js";
import { $, askName, hint, trunc } from "./util.js";
import { kindOf, partDef, partType, portsOfDef } from "./model.js";
import { addGlobalPort, pairMenu, pairable, pairedClock } from "./nets.js";
import { applyOp } from "./store.js";
import {
  addComponent,
  deletePart,
  deletePort,
  flipComponent,
  flipPorts,
  insertColumn,
  isPicked,
  moveColumn,
  newPort,
  newSheetPort,
  removeColumn,
  renameDef,
  renamePart,
  renamePort,
  setKind,
  setPartDef,
  setPortType,
  setPortsType,
  togglePick,
  uniquePortName,
} from "./edits.js";
import { render } from "./render.js";
import { openSheet, svgPoint } from "./interaction.js";

// ------------------------------------------------------------------ context menu
export function menu(x, y, items) {
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
export function hideMenu() {
  $("menu").hidden = true;
}
export function portDefMenu(x, y, P, port, cur) {
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
export function libraryMenu(x, y, D, col, yy) {
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
export function kindsAvailable() {
  return Object.keys(KIND_COLORS).filter(
    (k) => partDef(k) && k !== "FpgaComponent" && k !== "Container",
  );
}
export function edgeMenu(ev, side) {
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
        newSheetPort(D, name, side, y);
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
export function colMenu(ev, col) {
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
    act: () => editDoc(`Description of ${D}`, { def: D }),
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
export function compMenu(ev, D, name) {
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
        newPort(P, n, "left");
      },
    },
    { sep: true },
    {
      label: `Description of ${P}${partDef(P) && partDef(P).doc ? " ✓" : ""}…`,
      act: () => editDoc(`Description of ${P} (every instance)`, { def: P }),
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
            act: () => setKind(P, k),
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
              act: () => setPartDef(D, name, n),
            });
        menu(ev.clientX, ev.clientY, items);
      },
    },
    { sep: true },
    { label: "Delete", danger: true, act: () => deletePart(D, name) },
  ]);
}
// ------------------------------------------------------------------ descriptions (SysML `doc`)
export const DOC_HINT =
  "Plain text for readers outside FPGA design. It goes into the VHDL comments and the documents. Empty removes it.";
export function askText(title, value, hintText) {
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
// A description (SysML doc) and a port's readable name are model operations
// (core.ops.set_doc, set_port_name, via the server).
export async function editDoc(title, target, hintText) {
  // target: { def } or { def, port }
  const obj = target.port
    ? portsOfDef(target.def).find((p) => p.name === target.port)
    : S.defs[target.def] && S.defs[target.def].def;
  if (!obj) return;
  const text = await askText(title, obj.doc, hintText);
  if (text === null) return;
  const t = text
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim();
  if ((obj.doc || "") === t) return;
  return applyOp("set_doc", {
    def: target.def,
    port: target.port || null,
    text: t,
  });
}
// A port's readable SysML name ("Processing CSR"); its identifier stays `name`
// (in the file: name = the readable text, shortName = the identifier).
export async function editLabel(P, name) {
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
  return applyOp("set_port_name", { def: P, port: name, name: t || null });
}
export function portMenu(ev, P, name, isEdge) {
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
                act: () => setPortsType(S.picked, t),
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
        editDoc(`Description of port ${P}.${name}`, { def: P, port: name }),
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
