import { DEAL_FLOW } from "@gratovo/core";
import { describe, expect, it } from "vitest";

import { money } from "../lib/format";
import { strings } from "../strings";
import { brandSub, creatorSub, dealSub } from "./record-text";

const step = (index: number): string => DEAL_FLOW[index]?.name ?? "";

describe("dealSub", () => {
  it("shows the step and the price", () => {
    expect(dealSub({ id: "d1", brand: "b1", creator: "c3", step: 1, price: 4800 })).toBe(
      `${step(1)} · ${money(4800)}`,
    );
  });

  it("shows only the step when the price is hidden", () => {
    const sub = dealSub({ id: "d1", brand: "b1", creator: "c3", step: 1, price: null });
    expect(sub).toBe(step(1));
    expect(sub).not.toContain("$");
  });

  it("names an unknown step", () => {
    expect(dealSub({ id: "d1", brand: "b1", creator: "c3", step: 999, price: null })).toBe(
      strings.record.unknownName,
    );
  });
});

describe("creatorSub and brandSub", () => {
  it("joins the parts with a dot, leaving out a missing email", () => {
    const creator = {
      id: "c12",
      name: "Prompt Daily",
      handle: "@promptdaily",
      stage: "new",
      email: null,
      emailConfirmed: false,
      rejectReason: null,
      rejectedAt: null,
      archiveDueAt: null,
    } as const;
    expect(creatorSub(creator)).toBe(`@promptdaily · ${strings.record.stages.new}`);
    expect(creatorSub({ ...creator, email: "hi@promptdaily.ai" })).toBe(
      `@promptdaily · ${strings.record.stages.new} · hi@promptdaily.ai`,
    );
    expect(brandSub({ id: "b5", name: "Clipforge", sells: "AI video editor", status: "won" })).toBe(
      `AI video editor · ${strings.record.brandStatus.won}`,
    );
  });
});
