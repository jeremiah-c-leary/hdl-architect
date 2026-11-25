// HA 2: asking the user for a name or a text (the browser's prompt and the
// text dialog). The core checks names again: here it is only for immediate
// feedback while typing.
import { NAME_RE } from "./state.js";
import { $ } from "./svg.js";

export function askName(question, def) {
  for (;;) {
    const v = prompt(question, def || "");
    if (v === null) return null;
    const t = v.trim();
    if (NAME_RE.test(t)) return t;
    alert(
      `"${t}" is not a legal name: a letter, then letters, digits and single underscores (it must also be a legal VHDL name).`,
    );
    def = t
      .replace(/[^A-Za-z0-9_]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
  }
}
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
