import { describe, expect, it } from "vitest";

import { mentionsMoney, moneyFields } from "./money";

describe("moneyFields", () => {
  it("lists the three amount fields", () => {
    expect(moneyFields).toEqual(["brand_price", "influencer_payout", "budget"]);
  });
});

describe("mentionsMoney", () => {
  it("catches a currency sign before a digit", () => {
    for (const text of ["$4,000", "Paid $ 500 for the sponsor slot", "€12.50", "£300 retainer"]) {
      expect(mentionsMoney(text)).toBe(true);
    }
  });

  it("catches a number next to a currency word", () => {
    for (const text of ["4000 USD", "USD 4000", "2,500 eur", "gbp 90", "300 dollars", "1 dollar"]) {
      expect(mentionsMoney(text)).toBe(true);
    }
  });

  it("leaves near misses alone", () => {
    for (const text of [
      "2 videos",
      "@cash_ai",
      "v1.5",
      "GPT-4o",
      "Dollars and Sense podcast",
      "USD pricing",
      "$ sign",
    ]) {
      expect(mentionsMoney(text)).toBe(false);
    }
  });
});
