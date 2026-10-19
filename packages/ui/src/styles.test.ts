import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { expectRulesMatchPrototype } from "./testing/prototype-styles.js";

const fontsFile = new URL("./fonts.css", import.meta.url);

describe("shared styles", () => {
  // Deviations (rule key -> why it differs) go here. None so far: every rule is the prototype's.
  it("base.css matches the prototype rule for rule", () => {
    expectRulesMatchPrototype(new URL("./base.css", import.meta.url));
  });

  it("controls.css matches the prototype rule for rule", () => {
    expectRulesMatchPrototype(new URL("./controls.css", import.meta.url));
  });

  it("motion.css matches the prototype rule for rule", () => {
    expectRulesMatchPrototype(new URL("./motion.css", import.meta.url));
  });
});

describe("fonts.css", () => {
  const css = readFileSync(fontsFile, "utf8");
  const require = createRequire(import.meta.url);

  it("points every url() at a font file that exists", () => {
    const urls = [...css.matchAll(/url\("([^"]+)"\)/g)].map((match) => match[1] ?? "");
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(() => require.resolve(url), `${url} does not resolve`).not.toThrow();
    }
  });

  it("names exactly the two families the tokens use", () => {
    const families = new Set([...css.matchAll(/font-family:\s*"([^"]+)"/g)].map((m) => m[1]));
    expect([...families].sort()).toEqual(["IBM Plex Mono", "Readex Pro"]);
  });

  it("has IBM Plex Mono in 400, 500 and 600", () => {
    const plex = css
      .split("@font-face {")
      .filter((block) => block.includes('font-family: "IBM Plex Mono"'))
      .map((block) => /font-weight:\s*(\d+)/.exec(block)?.[1]);
    expect(new Set(plex)).toEqual(new Set(["400", "500", "600"]));
  });
});
