import { describe, expect, it } from "vitest";

import { crossKeywords } from "./keyword-gen";
import { defaultAngles, defaultTools, keywordKey } from "./keyword-lists";

describe("crossKeywords", () => {
  it("crosses 40 x 10 into 400 unique keywords", () => {
    expect(defaultTools).toHaveLength(40);
    expect(defaultAngles).toHaveLength(10);
    const all = crossKeywords(defaultTools, defaultAngles);
    expect(all).toHaveLength(400);
    expect(new Set(all.map((k) => keywordKey(k.keyword))).size).toBe(400);
  });

  it("covers every tool and angle in the first 40 and 10", () => {
    const all = crossKeywords(defaultTools, defaultAngles);
    expect(new Set(all.slice(0, 40).map((k) => k.tool)).size).toBe(40);
    expect(new Set(all.slice(0, 10).map((k) => k.angle)).size).toBe(10);
  });

  it("fills a template angle and joins the others", () => {
    const out = crossKeywords(["Claude  Code"], ["How to use {tool}", "pricing"]);
    expect(out.map((k) => k.keyword)).toEqual(["how to use claude code", "claude code pricing"]);
  });

  it("dedupes by key and caps at 200 characters", () => {
    expect(crossKeywords(["a", "A "], ["x"])).toHaveLength(1);
    expect(crossKeywords(["t".repeat(300)], ["x"])[0]?.keyword.length).toBeLessThanOrEqual(200);
  });
});
