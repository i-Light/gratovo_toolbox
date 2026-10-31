import { describe, expect, it } from "vitest";

import { creatorOverviewBlocks, creatorStepIndex, type OverviewFacts } from "./record";

const none: OverviewFacts = {
  hasReason: false,
  hasWarnings: false,
  hasContact: false,
  hasEmails: false,
  hasReply: false,
  hasDraft: false,
  hasRelationship: false,
  hasUpdate: false,
  hasLocks: false,
  hasOnboarding: false,
  hasDeals: false,
  hasRate: false,
  seesMoney: false,
};
const all: OverviewFacts = {
  hasReason: true,
  hasWarnings: true,
  hasContact: true,
  hasEmails: true,
  hasReply: true,
  hasDraft: true,
  hasRelationship: true,
  hasUpdate: true,
  hasLocks: true,
  hasOnboarding: true,
  hasDeals: true,
  hasRate: true,
  seesMoney: true,
};

describe("creatorOverviewBlocks", () => {
  it("new, shortlisted, rejected, parked and never: the numbers that decide", () => {
    for (const stage of ["new", "shortlisted", "rejected", "parked", "never"] as const) {
      expect(creatorOverviewBlocks(stage, none)).toEqual(["numbers", "videos", "fit"]);
      expect(creatorOverviewBlocks(stage, all)).toEqual([
        "numbers",
        "videos",
        "fit",
        "warnings",
        "reason",
      ]);
    }
  });

  it("contact and emailed: the contact, where the emails stand, the short numbers", () => {
    for (const stage of ["contact", "emailed"] as const) {
      expect(creatorOverviewBlocks(stage, none)).toEqual(["shortNumbers"]);
      expect(creatorOverviewBlocks(stage, all)).toEqual(["contact", "emails", "shortNumbers"]);
    }
  });

  it("replied, kit and audience: the reply, a waiting draft, the audience check at kit", () => {
    expect(creatorOverviewBlocks("replied", none)).toEqual(["shortNumbers"]);
    expect(creatorOverviewBlocks("replied", all)).toEqual(["reply", "draft", "shortNumbers"]);
    expect(creatorOverviewBlocks("audience", all)).toEqual(["reply", "draft", "shortNumbers"]);
    expect(creatorOverviewBlocks("kit", all)).toEqual([
      "reply",
      "draft",
      "audienceCheck",
      "shortNumbers",
    ]);
    expect(creatorOverviewBlocks("kit", none)).toEqual(["audienceCheck", "shortNumbers"]);
  });

  it("signed: the relationship and the rest, the rate only for money viewers", () => {
    expect(creatorOverviewBlocks("signed", none)).toEqual(["shortNumbers"]);
    expect(creatorOverviewBlocks("signed", all)).toEqual([
      "relationship",
      "update",
      "locks",
      "onboarding",
      "deals",
      "rate",
      "shortNumbers",
    ]);
    expect(creatorOverviewBlocks("signed", { ...all, seesMoney: false })).not.toContain("rate");
    expect(creatorOverviewBlocks("signed", { ...all, hasRate: false })).not.toContain("rate");
  });
});

describe("creatorStepIndex", () => {
  it("places the eight steps and gives none to rejected, parked and never", () => {
    expect(creatorStepIndex("new")).toBe(0);
    expect(creatorStepIndex("signed")).toBe(7);
    expect(creatorStepIndex("rejected")).toBeNull();
    expect(creatorStepIndex("parked")).toBeNull();
    expect(creatorStepIndex("never")).toBeNull();
  });
});
