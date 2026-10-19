import { describe, expect, it } from "vitest";

import { DEAL_FLOW } from "../deal-flow";
import {
  creatorStageFrom,
  dealStepFrom,
  legacyCreatorFields,
  legacyDealStage,
  primaryEmail,
} from "./legacy-mapping";
import { creatorStages } from "./types";

/** A legacy creator row with no app column, as the old app writes it. */
const legacy = (vettingStatus: string, pipelineStage: string) => ({
  creatorStage: null,
  vettingStatus,
  pipelineStage,
});

describe("creatorStageFrom", () => {
  it("takes the app column when it holds a known stage", () => {
    for (const stage of creatorStages) {
      expect(
        creatorStageFrom({ creatorStage: stage, vettingStatus: "rejected", pipelineStage: "lost" }),
      ).toBe(stage);
    }
  });

  it("derives the stage when the app column holds an unknown value", () => {
    expect(
      creatorStageFrom({
        creatorStage: "drafted",
        vettingStatus: "newlyFound",
        pipelineStage: "contacted",
      }),
    ).toBe("emailed");
  });

  it("reads rejected vetting as rejected, whatever the pipeline says", () => {
    expect(creatorStageFrom(legacy("rejected", "new"))).toBe("rejected");
    expect(creatorStageFrom(legacy("rejected", "roster"))).toBe("rejected");
  });

  it("reads a new creator as new, or shortlisted when vetting is", () => {
    expect(creatorStageFrom(legacy("newlyFound", "new"))).toBe("new");
    expect(creatorStageFrom(legacy("shortlisted", "new"))).toBe("shortlisted");
  });

  it.each([
    ["contacted", "emailed"],
    ["interested", "replied"],
    ["roster", "signed"],
    ["negotiating", "signed"],
    ["contract", "signed"],
    ["awaitingDelivery", "signed"],
    ["paid", "signed"],
    ["lost", "parked"],
  ])("reads pipeline stage %s as %s", (pipelineStage, stage) => {
    expect(creatorStageFrom(legacy("shortlisted", pipelineStage))).toBe(stage);
  });

  it("reads an unknown pipeline stage as new", () => {
    expect(creatorStageFrom(legacy("newlyFound", "archived"))).toBe("new");
  });
});

describe("legacyCreatorFields", () => {
  it.each([
    ["new", "newlyFound", "new"],
    ["shortlisted", "shortlisted", "new"],
    ["contact", "shortlisted", "new"],
    ["emailed", "shortlisted", "contacted"],
    ["replied", "shortlisted", "interested"],
    ["kit", "shortlisted", "interested"],
    ["audience", "shortlisted", "interested"],
    ["signed", "shortlisted", "roster"],
    ["rejected", "rejected", "new"],
    ["parked", "newlyFound", "lost"],
    ["never", "newlyFound", "lost"],
  ] as const)("writes %s as (%s, %s)", (stage, vettingStatus, pipelineStage) => {
    expect(legacyCreatorFields(stage)).toEqual({ vettingStatus, pipelineStage });
  });

  it("gives fields that read back as the stage, or its nearest legacy stage", () => {
    const readBack = (stage: (typeof creatorStages)[number]) =>
      creatorStageFrom({ creatorStage: null, ...legacyCreatorFields(stage) });
    expect(creatorStages.map(readBack)).toEqual([
      "new",
      "shortlisted",
      "shortlisted",
      "emailed",
      "replied",
      "replied",
      "replied",
      "signed",
      "rejected",
      "parked",
      "parked",
    ]);
  });
});

describe("dealStepFrom", () => {
  it("takes the app column when it holds a valid step", () => {
    for (let step = 0; step < DEAL_FLOW.length; step += 1) {
      expect(dealStepFrom({ flowStep: step, stage: "closed" })).toBe(step);
    }
  });

  it("derives the step when the app column is out of range or not a whole number", () => {
    expect(dealStepFrom({ flowStep: -1, stage: "signed" })).toBe(2);
    expect(dealStepFrom({ flowStep: DEAL_FLOW.length, stage: "signed" })).toBe(2);
    expect(dealStepFrom({ flowStep: 1.5, stage: "signed" })).toBe(2);
  });

  it.each([
    ["proposed", 0],
    ["negotiating", 0],
    ["lost", 0],
    ["agreed", 1],
    ["contractSent", 1],
    ["signed", 2],
    ["live", 5],
    ["closed", 9],
    ["unknown", 0],
  ])("reads stage %s as step %i", (stage, step) => {
    expect(dealStepFrom({ flowStep: null, stage })).toBe(step);
  });
});

describe("legacyDealStage", () => {
  it.each([
    [-1, "negotiating"],
    [0, "negotiating"],
    [1, "contractSent"],
    [2, "signed"],
    [3, "signed"],
    [4, "signed"],
    [5, "live"],
    [6, "live"],
    [7, "live"],
    [8, "live"],
    [9, "closed"],
    [10, "closed"],
  ])("writes step %i as %s", (step, stage) => {
    expect(legacyDealStage(step)).toBe(stage);
  });

  it("gives a stage that reads back as a step no later than the one written", () => {
    for (let step = 0; step < DEAL_FLOW.length; step += 1) {
      const back = dealStepFrom({ flowStep: null, stage: legacyDealStage(step) });
      expect(back).toBeLessThanOrEqual(step);
    }
  });
});

describe("primaryEmail", () => {
  const json = (contacts: unknown): string => JSON.stringify(contacts);

  it("takes the email contact marked primary", () => {
    const contacts = [
      { method: "email", value: "first@promptlab.tv" },
      { method: "email", value: "biz@promptlab.tv", primary: true },
    ];
    expect(primaryEmail(json(contacts))).toBe("biz@promptlab.tv");
  });

  it("takes the first email contact when none is primary", () => {
    const contacts = [
      { method: "whatsapp", value: "+20 100 000 0000", primary: true },
      { method: "email", value: "hello@promptlab.tv" },
      { method: "email", value: "manager@promptlab.tv", label: "manager" },
    ];
    expect(primaryEmail(json(contacts))).toBe("hello@promptlab.tv");
  });

  it("trims the value", () => {
    expect(primaryEmail(json([{ method: "email", value: "  kai@codewithkai.dev " }]))).toBe(
      "kai@codewithkai.dev",
    );
  });

  it("is null when there is no email contact", () => {
    expect(primaryEmail("[]")).toBeNull();
    expect(
      primaryEmail(json([{ method: "instagram", value: "@promptlab", primary: true }])),
    ).toBeNull();
  });

  it("skips entries it can't use", () => {
    const contacts = [
      null,
      "loose@string.com",
      42,
      { method: "email" },
      { method: "email", value: 7, primary: true },
      { method: "email", value: "   ", primary: true },
      { method: "email", value: "desk@theaidesk.news" },
    ];
    expect(primaryEmail(json(contacts))).toBe("desk@theaidesk.news");
  });

  it("is null for bad JSON or a value that isn't a list", () => {
    expect(primaryEmail("not json")).toBeNull();
    expect(primaryEmail("")).toBeNull();
    expect(primaryEmail(json({ method: "email", value: "x@y.com" }))).toBeNull();
    expect(primaryEmail("null")).toBeNull();
  });
});
