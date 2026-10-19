import { readFileSync } from "node:fs";

import postcss, { AtRule, type Root } from "postcss";
import { describe, expect, it } from "vitest";

const tokensFile = new URL("./tokens.css", import.meta.url);
const prototypeFile = new URL("../../../design/workbench-prototype/index.html", import.meta.url);

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

/** Writes a value the same way whatever the formatting: `.10` and `0.1` compare equal. */
function normalizeValue(value: string): string {
  return value
    .replace(/#[0-9a-f]+|-?\d*\.?\d+/gi, (token) =>
      token.startsWith("#") ? token.toLowerCase() : String(Number(token)),
    )
    .replace(/\s*,\s*/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSelector(selector: string): string {
  return selector
    .split(",")
    .map((part) => part.replace(/\s+/g, " ").trim())
    .join(", ");
}

/** Maps each rule to its declarations, for example `":root" => { "--bg": "#f2f5f9", ... }`. */
function declarationsByRule(root: Root): Map<string, Record<string, string>> {
  const rules = new Map<string, Record<string, string>>();
  root.walkRules((rule) => {
    const parent = rule.parent;
    const atRule = parent instanceof AtRule ? `@${parent.name} ${parent.params} ` : "";
    const key = atRule + normalizeSelector(rule.selector);
    const declarations = rules.get(key) ?? {};
    rule.walkDecls((decl) => {
      declarations[decl.prop] = normalizeValue(decl.value) + (decl.important ? " !important" : "");
    });
    rules.set(key, declarations);
  });
  return rules;
}

function prototypeStyles(): string {
  const html = readFileSync(prototypeFile, "utf8");
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1];
  if (style === undefined) {
    throw new Error("No <style> block in the prototype's index.html");
  }
  return style;
}

describe("tokens.css", () => {
  const tokens = declarationsByRule(postcss.parse(readFileSync(tokensFile, "utf8")));
  const prototype = declarationsByRule(postcss.parse(prototypeStyles()));

  it("holds the light, dark, density, size and motion rules and nothing else", () => {
    expect([...tokens.keys()]).toEqual(expectedRules);
  });

  it.each(expectedRules)("matches the prototype for %s", (rule) => {
    expect(prototype.has(rule), `the prototype has no rule ${rule}`).toBe(true);
    expect(tokens.get(rule)).toEqual(prototype.get(rule));
  });

  it("gives both dark rules the same values", () => {
    expect(tokens.get(expectedRules[1] ?? "")).toEqual(tokens.get(expectedRules[2] ?? ""));
  });
});
