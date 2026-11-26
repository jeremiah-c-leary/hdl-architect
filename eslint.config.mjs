// ESLint for HA 2: the recommended rules (formatting is Prettier's job), and
// the Clean Code rules (CLAUDE.md, "Code style") on every file not listed in
// NOT_YET_CLEAN.
// HA 2's browser code is ES modules: each file imports what it uses, so ESLint
// checks every name across files.
import js from "@eslint/js";
import globals from "globals";

// The Clean Code rules apply to every file of HA 2's browser code, new files
// included, except those not yet brought up to them. Each clean-up PR takes
// its file off this list; when it is empty, delete it.
const STATIC = "src/hdl_architect/editor/static/";
const NOT_YET_CLEAN = [
  "clocktree.js",
  "dialogs.js",
  "edits.js",
  "export.js",
  "interaction.js",
  "layout.js",
  "menus.js",
  "nets.js",
  "render.js",
  "state.js",
  "statusbar.js",
  "store.js",
  "svg.js",
];

// The Clean Code rules that a tool can check. "error" fails CI; "warn" only
// flags code for a person to look at.
const CLEAN_CODE = {
  // More than 3 arguments: they belong together in one object.
  "max-params": ["error", 3],
  // A literal true/false argument: the function is two functions.
  // A named import: a call should say which module it is in.
  "no-restricted-syntax": [
    "error",
    {
      selector:
        "CallExpression[callee.type='Identifier'] > Literal.arguments[raw=/^(true|false)$/]",
      message:
        "A true/false argument means two functions: split it into two, named for what each does.",
    },
    {
      selector: "ImportDeclaration > ImportSpecifier",
      message:
        'Import the module, not names from it (import * as store from "./store.js"; store.undo()), so every call says where it is defined.',
    },
  ],
  // Few paths through a function, and shallow nesting: extract functions.
  complexity: ["error", 6],
  "max-depth": ["error", 2],
  // No "a ? b : c ? d : e".
  "no-nested-ternary": "error",
  // Names that say what they are (x, y and id are names in their own right).
  "id-length": [
    "error",
    { min: 3, properties: "never", exceptions: ["x", "y", "id", "$"] },
  ],
  // Long functions are flagged for review, not refused: some are fine.
  "max-lines-per-function": [
    "warn",
    { max: 20, skipBlankLines: true, skipComments: true },
  ],
};

const config = [
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

// The Clean Code rules, on every file but those not yet clean.
config.push({
  files: [STATIC + "**/*.js"],
  ignores: NOT_YET_CLEAN.map((name) => STATIC + name),
  rules: CLEAN_CODE,
});

export default config;
