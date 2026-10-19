import { describe, expect, it } from "vitest";

import { DEAL_FLOW } from "./deal-flow";

describe("DEAL_FLOW", () => {
  it("has the ten steps of a deal, in order", () => {
    expect(DEAL_FLOW.map((step) => step.key)).toEqual([
      "negotiate",
      "contracts",
      "brief",
      "draft",
      "prelive",
      "golive",
      "invoice",
      "report",
      "pay",
      "next",
    ]);
  });

  it("keeps every step with at least one checklist item", () => {
    for (const step of DEAL_FLOW) {
      expect(step.items.length, step.key).toBeGreaterThan(0);
    }
  });

  it("marks contracts as ordered and pay as locked until the brand pays", () => {
    const byKey = new Map(DEAL_FLOW.map((step) => [step.key, step]));
    expect(byKey.get("contracts")?.ordered).toBe(true);
    expect(byKey.get("pay")?.lockedUntilPaid).toBe(true);
  });
});
