// HA 2: The model index and queries; the wires on a sheet.
import { COLLS, CONTAINER_KINDS, KIND_COLORS, editor } from "./state.js";

// ------------------------------------------------------------------ model index and queries
/**
 * Build editor.sysmlDefinitions: every SysML definition in every package (part, port,
 * attribute, item, metadata and action defs), by name, with its package.
 * Rebuilt after every change, so lookups like partDef("Uart") stay current.
 */
export function indexSysmlDefinitions() {
  editor.sysmlDefinitions = {};
  for (const pkg of editor.sysmlPackages)
    for (const coll of COLLS)
      for (const d of pkg.model.package[coll] || [])
        editor.sysmlDefinitions[d.name] = { pkg, coll, def: d };
}
export const short = (n) => (n || "").split("::").pop();
export function partDef(n) {
  const e = editor.sysmlDefinitions[short(n)];
  return e && e.coll === "partDefs" ? e.def : null;
}
export function portDef(n) {
  const e = editor.sysmlDefinitions[short(n)];
  return e && e.coll === "portDefs" ? e.def : null;
}
export function pkgOf(n) {
  const e = editor.sysmlDefinitions[short(n)];
  return e ? e.pkg : null;
}
export function kindOf(n, seen = new Set()) {
  n = short(n);
  if (KIND_COLORS[n]) return n;
  if (seen.has(n)) return null;
  seen.add(n);
  const d = partDef(n);
  for (const s of (d && d.specializes) || []) {
    const k = kindOf(s, seen);
    if (k) return k;
  }
  return null;
}
export function isSheet(n) {
  const d = partDef(n);
  return (
    !!d &&
    ((d.parts || []).length > 0 || CONTAINER_KINDS.has(kindOf(n))) &&
    !d.isAbstract
  );
}
export function partsOf(D) {
  return partDef(D).parts || [];
}
export function partType(D, part) {
  const p = partsOf(D).find((x) => x.name === part);
  return p ? short(p.type) : null;
}
export function portsOfDef(P) {
  const d = partDef(P);
  return d ? d.ports || [] : [];
}
export function counterpart(t) {
  if (!t) return undefined;
  const d = portDef(t);
  if (d && d.conjugateOf) return d.conjugateOf;
  for (const n in editor.sysmlDefinitions) {
    const e = editor.sysmlDefinitions[n];
    if (e.coll === "portDefs" && e.def.conjugateOf === short(t)) return n;
  }
  return t;
}
export function visibleIn(pkg, n) {
  // is definition n usable in pkg without a new import?
  const e = editor.sysmlDefinitions[short(n)];
  if (!e) return true;
  if (e.pkg === pkg) return true;
  return (pkg.model.package.imports || []).some(
    (i) => i.name.replace(/::\*$/, "") === e.pkg.model.package.name,
  );
}
export function ensureImport(pkg, n) {
  if (visibleIn(pkg, n)) return;
  const target = editor.sysmlDefinitions[short(n)].pkg.model.package.name;
  (pkg.model.package.imports = pkg.model.package.imports || []).push({
    name: target + "::*",
  });
}

// ------------------------------------------------------------------ wires on a sheet
export function parseEnd(D, s) {
  // null: not drawable here (a deeper chain, or broken)
  const bits = s.split(".");
  if (bits.length === 1)
    return portsOfDef(D).some((p) => p.name === s)
      ? { kind: "edge", port: s }
      : null;
  if (bits.length !== 2) return null;
  const part = partsOf(D).find((p) => p.name === bits[0]);
  if (!part || !portsOfDef(short(part.type)).some((p) => p.name === bits[1]))
    return null;
  return { kind: "part", part: bits[0], port: bits[1] };
}
export function brokenEnds(D) {
  // ends that name a part or port that does not exist
  const d = partDef(D),
    out = [];
  for (const c of [...(d.connections || []), ...(d.bindings || [])])
    for (const s of c.ends) {
      const bits = s.split(".");
      if (bits.length === 1 && !portsOfDef(D).some((p) => p.name === s))
        out.push(s);
      if (bits.length === 2) {
        const part = partsOf(D).find((p) => p.name === bits[0]);
        if (
          !part ||
          (partDef(short(part.type)) &&
            !portsOfDef(short(part.type)).some((p) => p.name === bits[1]))
        )
          out.push(s);
      }
    }
  return out;
}
export function endStr(e) {
  return e.kind === "edge" ? e.port : `${e.part}.${e.port}`;
}
export function wiresOf(D) {
  const d = partDef(D),
    out = [];
  let hidden = 0;
  (d.connections || []).forEach((c, i) => {
    const a = parseEnd(D, c.ends[0]),
      b = parseEnd(D, c.ends[1]);
    if (a && b) out.push({ kind: "connect", idx: i, a, b });
    else hidden++;
  });
  (d.bindings || []).forEach((c, i) => {
    const a = parseEnd(D, c.ends[0]),
      b = parseEnd(D, c.ends[1]);
    if (a && b) out.push({ kind: "bind", idx: i, a, b });
    else hidden++;
  });
  return { wires: out, hidden };
}
/** A port's readable name, else its identifier. */
export function shown(port) {
  return port.label || port.name;
}
