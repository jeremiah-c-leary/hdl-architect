// HA 2: Changes, undo/redo, saving, the server check.
import { COLLS, S } from "./state.js";
import { hint, setStatus } from "./statusbar.js";
import { ensureImport, partDef, rebuildIndex, short } from "./model.js";
import { settle } from "./layout.js";
import { render, renderProblems } from "./render.js";

// ------------------------------------------------------------------ change, undo, save
export function snapshot() {
  return JSON.stringify(S.pkgs.map((p) => [p.model, p.layout || null]));
}
export function restore(snap) {
  JSON.parse(snap).forEach(([m, l], i) => {
    S.pkgs[i].model = m;
    S.pkgs[i].layout = l;
  });
}
export function mutate(fn) {
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
export function changed() {
  rebuildIndex();
  repairImports();
  if (S.sheet && partDef(S.sheet)) settle(S.sheet);
  render();
  scheduleSave();
}
export function repairImports() {
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
export function undo() {
  if (!S.undo.length) return;
  S.redo.push(snapshot());
  restore(S.undo.pop());
  changed();
}
export function redo() {
  if (!S.redo.length) return;
  S.undo.push(snapshot());
  restore(S.redo.pop());
  changed();
}

export let saveTimer = null,
  checkTimer = null;
export function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveAll, 350);
  setStatus("unsaved");
}
export async function put(url, body) {
  const r = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await r.json();
}
/** Run a model operation on the server (core.ops via POST /api/op). */
export async function runOp(op, args) {
  const bases = Object.fromEntries(S.pkgs.map((p) => [p.file, p.version]));
  const r = await fetch("/api/op", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op, ...args, bases }),
  });
  const res = await r.json();
  if (res.stale) S.stale = true;
  return res;
}
/** Take the files an operation changed: they are now saved as they are. */
export function takeChanged(changed) {
  for (const c of changed) {
    const p = S.pkgs.find((x) => x.file === c.file);
    p.model = c.model;
    p.version = c.version;
    S.saved[p.file] = Object.assign(S.saved[p.file] || {}, {
      m: JSON.stringify(c.model),
    });
  }
  rebuildIndex();
}
/**
 * Run a model operation as one undoable edit: save pending edits, run it on
 * the server (core.ops), take the files it changed, then `after(res)` for
 * drawing changes (port sides...). Returns the response, or null when it was
 * refused (the reason is shown: a pop-up for interfaces that do not fit, the
 * hint line otherwise).
 */
export async function applyOp(op, args, after) {
  const snap = snapshot();
  if (!(await flushSave())) {
    hint("Not done: save the open changes first.");
    return null;
  }
  const res = await runOp(op, args);
  if (res.error) {
    if (res.error.code === "interfaces") alert(res.error.message);
    render();
    hint(res.error.code === "interfaces" ? "" : res.error.message);
    return null;
  }
  takeChanged(res.changed);
  if (after) after(res);
  S.undo.push(snap);
  if (S.undo.length > 200) S.undo.shift();
  S.redo = [];
  changed();
  if (res.notes && res.notes.length) hint(res.notes.join(" "));
  return res;
}
/** Save now if an edit is waiting, so the files on disk are the page's. */
export async function flushSave() {
  clearTimeout(saveTimer);
  await saveAll();
  return !S.stale && !(S.saveProblems || []).length;
}
export async function saveAll() {
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
export async function check() {
  const r = await fetch("/api/check");
  S.serverProblems = (await r.json()).errors || [];
  renderProblems();
}
