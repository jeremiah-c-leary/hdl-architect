// ESLint for HA 2: the recommended rules (formatting is Prettier's job), and
// the Clean Code rules (CLAUDE.md, "Code style") on the files already brought
// up to them.
// HA 2's browser code is ES modules: each file imports what it uses, so ESLint
// checks every name across files.
import js from "@eslint/js";
import globals from "globals";

// Files brought up to the Clean Code rules, one PR per file. When every file
// is here, the rules apply to all of HA 2's browser code.
const STATIC = "src/hdl_architect/editor/static/";
const CLEAN_FILES = [];

// The Clean Code rules that a tool can check. "error" fails CI; "warn" only
// flags code for a person to look at.
const CLEAN_CODE = {
  // More than 3 arguments: they belong together in one object.
  "max-params": ["error", 3],
  // A literal true/false argument: the function is two functions.
  "no-restricted-syntax": [
    "error",
    {
      selector:
        "CallExpression[callee.type='Identifier'] > Literal.arguments[raw=/^(true|false)$/]",
      message:
        "A true/false argument means two functions: split it into two, named for what each does.",
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

// Each file brought up to the Clean Code rules (CLEAN_FILES).
if (CLEAN_FILES.length > 0) {
  const files = CLEAN_FILES.map((name) => STATIC + name);
  config.push({ files, rules: CLEAN_CODE });
}

export default config;
