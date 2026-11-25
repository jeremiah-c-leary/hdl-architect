// HA 2: export what is on screen (a sheet, the clock tree, the reset tree) as SVG or PNG,
// for documentation. Always in the light theme, without editing marks (selection, armed
// ports, resize grips), as a standalone file: styles are inlined, CSS variables resolved.
"use strict";

function exportCss() {
  let light = {},
    rules = [];
  for (const sheet of document.styleSheets) {
    let list;
    try {
      list = sheet.cssRules;
    } catch (e) {
      continue;
    }
    for (const r of list) {
      if (!(r instanceof CSSStyleRule)) continue; // skips @media (the dark theme)
      if (r.selectorText === ":root") {
        if (!Object.keys(light).length)
          for (const m of r.cssText.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g))
            light[m[1]] = m[2].trim();
        continue;
      }
      rules.push(r.cssText);
    }
  }
  const css = rules
    .join("\n")
    .replace(/var\((--[\w-]+)\)/g, (m, n) => light[n] || m);
  return { css, bg: light["--bg"] || "#ffffff" };
}

function exportSvgText(svgEl) {
  const c = svgEl.cloneNode(true);
  c.querySelectorAll(".grip").forEach((e) => e.remove());
  c.querySelectorAll(".sel, .armed, .picked").forEach((e) =>
    e.classList.remove("sel", "armed", "picked"),
  );
  const w = +svgEl.getAttribute("width"),
    h = +svgEl.getAttribute("height");
  c.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  c.setAttribute("viewBox", `0 0 ${w} ${h}`);
  c.removeAttribute("id");
  const { css, bg } = exportCss();
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = `svg { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }\n${css}`;
  const back = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  Object.entries({ x: 0, y: 0, width: w, height: h, fill: bg }).forEach(
    ([k, v]) => back.setAttribute(k, v),
  );
  c.insertBefore(back, c.firstChild);
  c.insertBefore(style, c.firstChild);
  return {
    text:
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      new XMLSerializer().serializeToString(c) +
      "\n",
    w,
    h,
  };
}

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

function exportAs(svgEl, base, fmt) {
  const { text, w, h } = exportSvgText(svgEl);
  const svgBlob = new Blob([text], { type: "image/svg+xml" });
  if (fmt === "svg") return download(svgBlob, base + ".svg");
  const img = new Image(),
    scale = 2;
  img.onload = () => {
    const cv = document.createElement("canvas");
    cv.width = w * scale;
    cv.height = h * scale;
    const g = cv.getContext("2d");
    g.scale(scale, scale);
    g.drawImage(img, 0, 0);
    URL.revokeObjectURL(img.src);
    cv.toBlob((b) => download(b, base + ".png"), "image/png");
  };
  img.src = URL.createObjectURL(svgBlob);
}

function fileBase(s) {
  return s.replace(/[^\w.-]+/g, "_");
}

document.getElementById("exportBtn").onclick = (ev) => {
  if (!S.sheet) return;
  const r = ev.target.getBoundingClientRect();
  menu(r.left, r.bottom + 4, [
    { head: `Export ${S.sheet}` },
    {
      label: "Sheet as SVG",
      act: () =>
        exportAs(document.getElementById("canvas"), fileBase(S.sheet), "svg"),
    },
    {
      label: "Sheet as PNG (2x)",
      act: () =>
        exportAs(document.getElementById("canvas"), fileBase(S.sheet), "png"),
    },
  ]);
};
for (const fmt of ["svg", "png"])
  document.getElementById("ctExport" + fmt.toUpperCase()).onclick = () =>
    exportAs(
      document.getElementById("ctSvg"),
      fileBase(`${S.sheet}-${CT.mode}-tree`),
      fmt,
    );
