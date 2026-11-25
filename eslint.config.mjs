// ESLint for HA 2: the recommended rules only (formatting is Prettier's job).
// HA 2's browser code is ES modules: each file imports what it uses, so ESLint
// checks every name across files.
import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["src/hdl_architect/editor/static/**/*.js"],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: 2023,
      globals: { ...globals.browser },
    },
  },
  // HA 2's behaviour tests run in Node (ES modules), not in the browser
  {
    files: ["tests/ha2/**/*.mjs"],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: 2023,
      globals: { ...globals.node },
    },
  },
];
