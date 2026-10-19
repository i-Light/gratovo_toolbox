// The plugins the root eslint.config.mjs uses. They are re-exported from this package so they
// load this package's own `typescript`: TypeScript 6, the newest that typescript-eslint
// supports. Everything else in the repository uses TypeScript 7.
// See docs/decisions/0007-toolchain-pins.md.
export { default as js } from "@eslint/js";
export { default as jsxA11y } from "eslint-plugin-jsx-a11y";
export { default as reactHooks } from "eslint-plugin-react-hooks";
export { default as globals } from "globals";
export { default as tseslint } from "typescript-eslint";
