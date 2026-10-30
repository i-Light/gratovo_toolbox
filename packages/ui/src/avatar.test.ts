import { describe, expect, it } from "vitest";

import { avatarColor, hash, initials } from "./avatar";

// Expected values were computed once by running the prototype's W.hash, W.initials and W.avColor
// (design/workbench-v6/js/core.js, lines 62-65) in Node.
const cases: readonly (readonly [string, number, string, string])[] = [
  ["Ada Lovelace", 4267605246, "AL", "#86651a"],
  ["@mira_ai", 2133107659, "MI", "#a8452e"],
  ["  ", 2982523533, "?", "#1f7a5a"],
  ["x", 4245442695, "X", "#3d5aa8"],
  ["Prompt Lab Weekly", 1660009723, "PL", "#1f7a5a"],
  ["", 2166136261, "?", "#7b4fae"],
  ["Jean-Luc  Picard Jr", 3547918145, "JP", "#3d5aa8"],
  ["owner", 4117187796, "OW", "#86651a"],
  ["ai news", 2520347934, "AN", "#9a3b62"],
];

describe("avatar helpers", () => {
  it.each(cases)("hash(%j) is %d", (text, expected) => {
    expect(hash(text)).toBe(expected);
  });

  it.each(cases)("initials(%j) is the prototype's", (text, _hash, expected) => {
    expect(initials(text)).toBe(expected);
  });

  it.each(cases)("avatarColor(%j) is the prototype's", (text, _hash, _initials, expected) => {
    expect(avatarColor(text)).toBe(expected);
  });
});
