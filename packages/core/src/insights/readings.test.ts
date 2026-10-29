import { describe, expect, it } from "vitest";
import { noKind, readingKind } from "./readings";

describe("readingKind", () => {
  it.each([
    ["inf.interested_vague", "interested"],
    ["inf.agrees", "interested"],
    ["inf.media_kit", "interested"],
    ["inf.who_are_you", "question"],
    ["inf.contract_question", "question"],
    ["inf.gives_rate", "rate"],
    ["inf.counter", "rate"],
    ["inf.later", "notNow"],
    ["inf.not_interested", "no"],
    ["any.unsubscribe", "no"],
    ["inf.has_manager", "manager"],
    ["any.out_of_office", "auto"],
    ["any.bounce", "bounce"],
    ["any.unclear", "other"],
    ["inf.something_new", "other"],
  ])("%s reads as %s", (id, kind) => {
    expect(readingKind(id, false)).toBe(kind);
  });

  it("a bounce flag wins over any id", () => {
    expect(readingKind(null, true)).toBe("bounce");
    expect(readingKind("inf.gives_rate", true)).toBe("bounce");
  });

  it("no id and no bounce has no reading", () => {
    expect(readingKind(null, false)).toBeNull();
    expect(readingKind("", false)).toBeNull();
  });
});

describe("noKind", () => {
  it.each([
    ["inf.later", "notNow"],
    ["inf.not_interested", "notInterested"],
    ["inf.has_manager", "manager"],
    ["inf.wants_upfront", "money"],
    ["inf.non_negotiable", "money"],
  ])("%s is %s", (id, kind) => {
    expect(noKind(id)).toBe(kind);
  });

  it("is null for anything else", () => {
    expect(noKind(null)).toBeNull();
    expect(noKind("inf.gives_rate")).toBeNull();
    expect(noKind("whatever")).toBeNull();
  });
});
