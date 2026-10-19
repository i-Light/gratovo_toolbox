import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { icons } from "./icons";

const prototypeFile = new URL("../../../design/workbench-prototype/js/core.js", import.meta.url);

/** Reads the `var I = { ... };` block of the prototype: `name:["...", ...]` entries, several to a line. */
function prototypeIcons(): [string, string[]][] {
  const source = readFileSync(prototypeFile, "utf8");
  const block = /var I = \{([\s\S]*?)\n\};/.exec(source)?.[1];
  if (block === undefined) {
    throw new Error("No `var I = { ... };` block in the prototype's core.js");
  }
  const entries: [string, string[]][] = [];
  for (const entry of block.matchAll(/(\w+):\[((?:"(?:[^"\\]|\\.)*"\s*,?\s*)*)\]/g)) {
    const strings = [...(entry[2] ?? "").matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((s) => s[1] ?? "");
    entries.push([entry[1] ?? "", strings]);
  }
  return entries;
}

describe("icons", () => {
  const expected = prototypeIcons();

  it("finds the prototype's icons", () => {
    expect(expected.length).toBeGreaterThan(80);
  });

  it("has the same names in the same order", () => {
    expect(Object.keys(icons)).toEqual(expected.map(([name]) => name));
  });

  it("has the same strings for every icon", () => {
    expect(Object.entries(icons)).toEqual(expected);
  });
});
