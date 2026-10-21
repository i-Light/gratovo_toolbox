import { describe, expect, it } from "vitest";

import { compactCount, parseKeywords } from "./find";

describe("parseKeywords", () => {
  it("splits on new lines and commas, trims and drops blanks", () => {
    expect(
      parseKeywords(" best ai video editor\n\n claude code tips, ai news today ,\r\n"),
    ).toEqual(["best ai video editor", "claude code tips", "ai news today"]);
  });
  it("returns nothing for blank text", () => {
    expect(parseKeywords(" \n , ")).toEqual([]);
  });
});

describe("compactCount", () => {
  it("shortens thousands and millions", () => {
    expect(compactCount(950)).toBe("950");
    expect(compactCount(50_000)).toBe("50K");
    expect(compactCount(1_250)).toBe("1.3K");
    expect(compactCount(2_000_000)).toBe("2M");
  });
  it("rolls 999,950 and up over to millions", () => {
    expect(compactCount(999_999)).toBe("1M");
  });
});
