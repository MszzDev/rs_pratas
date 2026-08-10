// @ts-check
const tseslint = require("typescript-eslint");
const js = require("@eslint/js");

module.exports = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", ".turbo/**", "coverage/**", "android/**"],
  },
);
