import { readFileSync } from "node:fs";

import postcss, { AtRule, type Root } from "postcss";
import { expect } from "vitest";

const prototypeFile = new URL("../../../../design/workbench-v6/index.html", import.meta.url);

/** Writes a value the same way whatever the formatting: `.10` and `0.1` compare equal. */
export function normalizeValue(value: string): string {
  return value
    .replace(/#[0-9a-f]+|-?\d*\.?\d+/gi, (token) =>
      token.startsWith("#") ? token.toLowerCase() : String(Number(token)),
    )
    .replace(/\s*,\s*/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

/** Writes a selector list the same way whatever the spacing and line breaks. */
export function normalizeSelector(selector: string): string {
  return selector
    .split(",")
    .map((part) =>
      // Spaces are collapsed first, so the combinator pattern needs at most one on each side
      // (no runs of `\s*` that could backtrack). `(?!=)` leaves `~=` in attribute selectors alone.
      part
        .replace(/\s+/g, " ")
        .replace(/ ?([>+~])(?!=) ?/g, " $1 ")
        .trim(),
    )
    .join(", ");
}

/** Maps each rule to its declarations, for example `":root" => { "--bg": "#f2f5f9", ... }`. */
export function declarationsByRule(root: Root): Map<string, Record<string, string>> {
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

/** The text of the `<style>` block in the prototype's index.html. */
export function prototypeStyles(): string {
  const html = readFileSync(prototypeFile, "utf8");
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1];
  if (style === undefined) {
    throw new Error("No <style> block in the prototype's index.html");
  }
  return style;
}

/** Writes media-query spacing one way, so `(max-width:900px)` and `(max-width: 900px)` match. */
function canonicalKey(key: string): string {
  return key.replace(/\(\s*([\w-]+)\s*:\s*/g, "($1: ");
}

function canonicalRules(root: Root): Map<string, Record<string, string>> {
  return new Map(
    [...declarationsByRule(root)].map(([key, declarations]) => [canonicalKey(key), declarations]),
  );
}

/** The `@keyframes` name a rule key belongs to, or undefined for any other rule. */
function keyframesName(key: string): string | undefined {
  return /^@(?:-\w+-)?keyframes (\S+) /.exec(key)?.[1];
}

/**
 * Fails, naming every rule at once, when a rule in `cssFile` is missing from the prototype or
 * has different declarations. A `@keyframes` block must also have exactly the prototype's steps.
 * `deviations` maps a rule key (at-rule prefix plus normalized selector) to the reason it is
 * allowed to differ; the reason is for readers. `@font-face` rules are not compared.
 */
export function expectRulesMatchPrototype(
  cssFile: URL,
  deviations: Readonly<Record<string, string>> = {},
): void {
  const ours = canonicalRules(postcss.parse(readFileSync(cssFile, "utf8")));
  const prototype = canonicalRules(postcss.parse(prototypeStyles()));
  const allowed = new Set(Object.keys(deviations).map(canonicalKey));
  const problems: string[] = [];

  expect(ours.size, `${cssFile.pathname} holds no rules`).toBeGreaterThan(0);
  for (const [key, declarations] of ours) {
    if (allowed.has(key)) continue;
    const expected = prototype.get(key);
    if (expected === undefined) {
      problems.push(`${key}: the prototype has no such rule`);
    } else if (JSON.stringify(declarations) !== JSON.stringify(expected)) {
      problems.push(
        `${key}: ${JSON.stringify(declarations)} differs from the prototype's ${JSON.stringify(expected)}`,
      );
    }
  }

  // A keyframes block that lost a step would still pass the rule-by-rule check above.
  const names = new Set([...ours.keys()].map(keyframesName).filter((n) => n !== undefined));
  for (const name of names) {
    const stepsOf = (rules: Map<string, unknown>): string[] =>
      [...rules.keys()].filter((key) => keyframesName(key) === name).sort();
    if (allowed.has(`@keyframes ${name}`)) continue;
    if (JSON.stringify(stepsOf(ours)) !== JSON.stringify(stepsOf(prototype))) {
      problems.push(`@keyframes ${name}: its steps differ from the prototype's`);
    }
  }

  expect(problems, problems.join("\n")).toEqual([]);
}
