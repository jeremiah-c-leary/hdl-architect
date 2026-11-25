// ESLint for HA 2's browser code: the recommended rules only (formatting is
// Prettier's job). HA 2's scripts are plain <script> files that share functions
// through the page's global scope, so each file lists the shared names it uses
// and the file that defines them. Moving to JS modules (import/export) would
// make these lists unnecessary.
import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["src/hdl_architect/editor/static/**/*.js"],
    languageOptions: {
      sourceType: "script",
      ecmaVersion: 2023,
      globals: { ...globals.browser },
    },
  },
  {
    files: ["src/hdl_architect/editor/static/app.js"],
    languageOptions: {
      globals: {
        CT: "readonly", // clocktree.js
        renderClockTree: "readonly", // clocktree.js
      },
    },
  },
  {
    files: ["src/hdl_architect/editor/static/clocktree.js"],
    languageOptions: {
      globals: {
        KIND_COLORS: "readonly", // app.js
        NET_COLORS: "readonly", // app.js
        S: "readonly", // app.js
        el: "readonly", // app.js
        fmtHz: "readonly", // app.js
        kindOf: "readonly", // app.js
        netsOf: "readonly", // app.js
        partDef: "readonly", // app.js
        partType: "readonly", // app.js
        partsOf: "readonly", // app.js
        portUsage: "readonly", // app.js
        short: "readonly", // app.js
        tip: "readonly", // app.js
        trunc: "readonly", // app.js
      },
    },
  },
  {
    files: ["src/hdl_architect/editor/static/export.js"],
    languageOptions: {
      globals: {
        CT: "readonly", // clocktree.js
        S: "readonly", // app.js
        menu: "readonly", // app.js
      },
    },
  },
];
