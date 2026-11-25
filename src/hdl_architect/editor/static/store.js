// HA 2: Changes, undo/redo, saving, the server check.
import { COLLS, S } from "./state.js";
import { $ } from "./util.js";
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
export function setStatus(t, err) {
  const s = $("status");
  s.textContent = t;
  s.className = err ? "err" : "";
}
