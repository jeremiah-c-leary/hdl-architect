// HA 2: Changes, undo/redo, saving, the server check.
import { COLLS, editor } from "./state.js";
import { setStatus, showHint } from "./statusbar.js";
import {
  ensureImport,
  partDef,
  indexSysmlDefinitions,
  short,
} from "./model.js";
import { settle } from "./layout.js";
import { render, renderProblems } from "./render.js";

// ------------------------------------------------------------------ change, undo, save
export function snapshot() {
  return JSON.stringify(
    editor.sysmlPackages.map((p) => [p.model, p.layout || null]),
  );
}
export function restore(snap) {
  JSON.parse(snap).forEach(([m, l], i) => {
    editor.sysmlPackages[i].model = m;
    editor.sysmlPackages[i].layout = l;
  });
}
export function mutate(fn) {
  const snap = snapshot();
  let ok;
  try {
    ok = fn();
  } catch (err) {
    restore(snap);
    indexSysmlDefinitions();
    alert(err.message);
    return;
  }
  if (ok === false) {
    restore(snap);
    indexSysmlDefinitions();
    render();
    return;
  }
  editor.undo.push(snap);
  if (editor.undo.length > 200) editor.undo.shift();
  editor.redo = [];
  changed();
}
export function changed() {
  indexSysmlDefinitions();
  repairImports();
  if (editor.sheet && partDef(editor.sheet)) settle(editor.sheet);
  render();
  scheduleSave();
}
export function repairImports() {
  // every definition a package refers to must be visible in it: add missing imports
  for (const pkg of editor.sysmlPackages)
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
        for (const r of refs)
          if (r && editor.sysmlDefinitions[short(r)]) ensureImport(pkg, r);
      }
}
export function undo() {
  if (!editor.undo.length) return;
  editor.redo.push(snapshot());
  restore(editor.undo.pop());
  changed();
}
export function redo() {
  if (!editor.redo.length) return;
  editor.undo.push(snapshot());
  restore(editor.redo.pop());
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
  const bases = Object.fromEntries(
    editor.sysmlPackages.map((p) => [p.file, p.version]),
  );
  const r = await fetch("/api/op", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op, ...args, bases }),
  });
  const res = await r.json();
  if (res.stale) editor.stale = true;
  return res;
}
/**
 * Record every file's model and layout, as text, as what is on disk now.
 * saveAll compares against this to send only what has changed since.
 */
export function markAllSysmlPackagesSaved() {
  for (const pkg of editor.sysmlPackages)
    editor.saved[pkg.file] = {
      modelText: JSON.stringify(pkg.model),
      layoutText: JSON.stringify(pkg.layout || null),
    };
}
/** Take the files an operation changed: they are now saved as they are. */
export function takeChanged(changed) {
  for (const c of changed) {
    const p = editor.sysmlPackages.find((x) => x.file === c.file);
    p.model = c.model;
    p.version = c.version;
    editor.saved[p.file] = Object.assign(editor.saved[p.file] || {}, {
      modelText: JSON.stringify(c.model),
    });
  }
  indexSysmlDefinitions();
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
    showHint("Not done: save the open changes first.");
    return null;
  }
  const res = await runOp(op, args);
  if (res.error) {
    if (res.error.code === "interfaces") alert(res.error.message);
    render();
    showHint(res.error.code === "interfaces" ? "" : res.error.message);
    return null;
  }
  takeChanged(res.changed);
  if (after) after(res);
  editor.undo.push(snap);
  if (editor.undo.length > 200) editor.undo.shift();
  editor.redo = [];
  changed();
  if (res.notes && res.notes.length) showHint(res.notes.join(" "));
  return res;
}
/** Save now if an edit is waiting, so the files on disk are the page's. */
export async function flushSave() {
  clearTimeout(saveTimer);
  await saveAll();
  return !editor.stale && !(editor.saveProblems || []).length;
}
export async function saveAll() {
  setStatus("saving…");
  const problems = [];
  for (const pkg of editor.sysmlPackages) {
    // what is in the page now, and what was last saved, as text
    const modelText = JSON.stringify(pkg.model),
      layoutText = JSON.stringify(pkg.layout || null);
    const saved = editor.saved[pkg.file] || {};
    if (modelText !== saved.modelText) {
      const res = await put("/api/file", {
        file: pkg.file,
        model: pkg.model,
        base: pkg.version,
      });
      const errs = res.errors || [];
      if (errs.length) problems.push(...errs.map((e) => `${pkg.file}: ${e}`));
      else {
        saved.modelText = modelText;
        pkg.version = res.version;
      }
      if (res.stale) editor.stale = true;
    }
    if (pkg.layout && layoutText !== saved.layoutText) {
      const res = await put("/api/layout", {
        file: pkg.file,
        layout: pkg.layout,
        base: pkg.layoutVersion,
      });
      const errs = res.errors || [];
      if (errs.length)
        problems.push(...errs.map((e) => `${pkg.file} (layout): ${e}`));
      else {
        saved.layoutText = layoutText;
        pkg.layoutVersion = res.version;
      }
      if (res.stale) editor.stale = true;
    }
    editor.saved[pkg.file] = saved;
  }
  editor.saveProblems = problems;
  setStatus(
    editor.stale
      ? "changed on disk: reload"
      : problems.length
        ? "not saved"
        : "saved",
    !!problems.length,
  );
  renderProblems();
  clearTimeout(checkTimer);
  checkTimer = setTimeout(checkModel, 400);
}
/** Ask the server to check the whole model (schema, names, imports, as
 * `ha check`) and list its problems under the sheet. */
export async function checkModel() {
  const r = await fetch("/api/check");
  editor.serverProblems = (await r.json()).errors || [];
  renderProblems();
}
