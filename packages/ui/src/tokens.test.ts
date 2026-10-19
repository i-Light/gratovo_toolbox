import { readFileSync } from "node:fs";

import postcss from "postcss";
import { describe, expect, it } from "vitest";

import { declarationsByRule, prototypeStyles } from "./testing/prototype-styles.js";

const tokensFile = new URL("./tokens.css", import.meta.url);

/** Every rule tokens.css holds, keyed by its at-rule (if any) and selector. */
const expectedRules = [
  ":root",
  '@media (prefers-color-scheme: dark) :root:not([data-theme="light"])',
  ':root[data-theme="dark"]',
  ':root[data-density="compact"]',
  ':root[data-size="large"]',
  ':root[data-size="large"][data-density="compact"]',
  ':root[data-input="kbd"] *, :root[data-input="kbd"] *::before, :root[data-input="kbd"] *::after',
  ':root[data-motion="reduce"] *, :root[data-motion="reduce"] *::before, :root[data-motion="reduce"] *::after',
  "@media (prefers-reduced-motion: reduce) *, *::before, *::after",
];

describe("tokens.css", () => {
  const tokens = declarationsByRule(postcss.parse(readFileSync(tokensFile, "utf8")));
  const prototype = declarationsByRule(postcss.parse(prototypeStyles()));

  it("holds the light, dark, density, size and motion rules and nothing else", () => {
    expect([...tokens.keys()]).toEqual(expectedRules);
  });

  it("ports every page-wide token rule the prototype has", () => {
    // Rules scoped to a component (".pal", ".app.rail-min") set their own tokens and come with
    // that component in 3c. Rules on :root set tokens for the whole page and belong here.
    const pageWide = [...prototype]
      .filter(([rule, declarations]) => {
        const selector = rule.replace(/^@\S+ \([^)]*\) /, "");
        return (
          selector.startsWith(":root") && Object.keys(declarations).some((p) => p.startsWith("--"))
        );
      })
      .map(([rule]) => rule);
    expect(pageWide.length).toBeGreaterThan(0);
    expect(expectedRules).toEqual(expect.arrayContaining(pageWide));
  });

  it.each(expectedRules)("matches the prototype for %s", (rule) => {
    expect(prototype.has(rule), `the prototype has no rule ${rule}`).toBe(true);
    expect(tokens.get(rule)).toEqual(prototype.get(rule));
  });

  it("gives both dark rules the same values", () => {
    expect(tokens.get(expectedRules[1] ?? "")).toEqual(tokens.get(expectedRules[2] ?? ""));
  });
});
