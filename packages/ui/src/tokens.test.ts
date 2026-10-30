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

/**
 * Values that differ from the prototype on purpose: rule -> property -> { value, why }.
 */
const insightsWhy =
  "Insights (P8a, design 2a): series colours and the raised panel; not in the prototype.";
const insightsTokens: Record<string, { value: string; why: string }> = Object.fromEntries(
  Object.entries({
    "--series-live": "#3a9ad3",
    "--series-waiting": "#c8711f",
    "--series-archive": "#8a7ae6",
    "--series-rules": "#4a4380",
    "--series-neutral": "#3d5a72",
    "--raised-top": "#10293d",
    "--raised-highlight": "rgba(255,255,255,0.04)",
    "--raised-shadow": "0 1px 0 rgba(0,0,0,0.4),0 12px 32px -12px rgba(0,0,0,0.6)",
  }).map(([name, value]) => [name, { value, why: insightsWhy }]),
);

const deviations: Record<string, Record<string, { value: string; why: string }>> = {
  '@media (prefers-color-scheme: dark) :root:not([data-theme="light"])': insightsTokens,
  ':root[data-theme="dark"]': insightsTokens,
  ":root": {
    ...insightsTokens,
    "--faint": {
      value: "#7d8fa2",
      why: "Light theme (v6 changed it to #5d7083): the app runs dark only, and the light values stay as they were until the owner asks for light.",
    },
    "--good": {
      value: "#17803a",
      why: "Light theme (v6 changed it to #147433): same reason as --faint.",
    },
    "--r-panel": { value: "16px", why: insightsWhy },
    "--muted": {
      value: "#566678",
      why: "Contrast (3c-3, F7): the prototype's #64778b reads 3.96 to 4.26:1 on the sunk and accent-soft surfaces; #566678 keeps the hue and reads at least 4.72:1 on every light surface.",
    },
  },
};

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
    const changed = Object.fromEntries(
      Object.entries(deviations[rule] ?? {}).map(([prop, { value }]) => [prop, value]),
    );
    expect(tokens.get(rule)).toEqual({ ...prototype.get(rule), ...changed });
  });

  it("gives both dark rules the same values", () => {
    expect(tokens.get(expectedRules[1] ?? "")).toEqual(tokens.get(expectedRules[2] ?? ""));
  });
});
