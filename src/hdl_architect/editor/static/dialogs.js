// HA 2: asking the user for a name or a text (the browser's prompt and the
// text dialog). The core checks names again: here it is only for immediate
// feedback while typing.
import * as state from "./state.js";
import * as svg from "./svg.js";

/** Ask for a legal name, offering `suggestion`; null if cancelled. */
export function askName(question, suggestion) {
  let offered = suggestion || "";
  for (;;) {
    const answer = prompt(question, offered);
    if (answer === null) return null;
    const name = answer.trim();
    if (state.NAME_RE.test(name)) return name;
    alert(
      `"${name}" is not a legal name: a letter, then letters, digits and single underscores (it must also be a legal VHDL name).`,
    );
    offered = legalized(name);
  }
}

/** The nearest legal name: other characters become single underscores. */
function legalized(name) {
  return name
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export const DOC_HINT =
  "Plain text for readers outside FPGA design. It goes into the VHDL comments and the documents. Empty removes it.";

/** Ask for a text in the text dialog; resolves to null if cancelled. */
export function askText(title, value, hintText) {
  const dialog = svg.$("textDlg");
  const textArea = svg.$("textDlgText");
  svg.$("textDlgTitle").textContent = title;
  svg.$("textDlgHint").textContent = hintText || DOC_HINT;
  textArea.value = value || "";
  textArea.onkeydown = okOnCtrlEnter;
  return new Promise((resolve) => {
    dialog.onclose = () =>
      resolve(dialog.returnValue === "ok" ? textArea.value : null);
    dialog.returnValue = "";
    dialog.showModal();
    textArea.focus();
  });
}

/** Ctrl+Enter (Cmd+Enter on a Mac) is OK. */
function okOnCtrlEnter(event) {
  if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
  event.preventDefault();
  svg.$("textDlgOk").click();
}
