import { describe, expect, it } from "vitest";
import { defaultAgencyFacts as facts } from "../data";
import type { PriceInput } from "./engine-types";
import { packagesFor, payoutFor, priceFor } from "./pricing";

function creator(over: Partial<PriceInput> = {}): PriceInput {
  return { views: 100_000, rate: null, relationship: null, ...over };
}

describe("priceFor", () => {
  it("prices on views at the CPM when there is no rate", () => {
    expect(priceFor(creator(), facts)).toBe(4000);
  });

  it("assumes 45,000 views when none are known", () => {
    expect(priceFor(creator({ views: null }), facts)).toBe(1800);
  });

  it("rounds to the nearest 50", () => {
    expect(priceFor(creator({ views: 61_000 }), facts)).toBe(2450);
  });

  it("adds the markup on a brokered rate when that is more than the CPM price", () => {
    expect(priceFor(creator({ rate: 3000, relationship: "brokered" }), facts)).toBe(4800);
    expect(priceFor(creator({ rate: 3000 }), facts)).toBe(4800);
  });

  it("keeps the CPM price when the marked-up rate is lower", () => {
    expect(priceFor(creator({ rate: 1000 }), facts)).toBe(4000);
  });

  it("grosses up an exclusive creator's rate by the commission", () => {
    expect(priceFor(creator({ rate: 3600, relationship: "exclusive_25" }), facts)).toBe(4800);
  });

  it("keeps the CPM price on exclusive when the grossed-up rate is lower or there is no rate", () => {
    expect(priceFor(creator({ rate: 3000, relationship: "exclusive_25" }), facts)).toBe(4000);
    expect(priceFor(creator({ relationship: "exclusive_25" }), facts)).toBe(4000);
  });

  it("applies the format multipliers", () => {
    expect(priceFor(creator(), facts, { format: "integration" })).toBe(4000);
    expect(priceFor(creator(), facts, { format: "shoutout" })).toBe(2800);
    expect(priceFor(creator(), facts, { format: "dedicated" })).toBe(10_000);
    expect(priceFor(creator(), facts, { format: "short" })).toBe(2600);
  });

  it("adds 25% for whitelisting", () => {
    expect(priceFor(creator(), facts, { whitelisting: true })).toBe(5000);
    expect(priceFor(creator(), facts, { whitelisting: false })).toBe(4000);
  });

  it("takes 8% off a bundle of three or more, and ignores smaller ones", () => {
    expect(priceFor(creator(), facts, { bundle: 3 })).toBe(11_050);
    expect(priceFor(creator(), facts, { bundle: 2 })).toBe(4000);
  });
});

describe("payoutFor", () => {
  it("pays an exclusive creator the gross less our commission", () => {
    expect(payoutFor(creator({ relationship: "exclusive_25", rate: 1 }), 4000, facts)).toBe(3000);
  });

  it("pays a brokered creator their own rate", () => {
    expect(payoutFor(creator({ rate: 1500 }), 4000, facts)).toBe(1500);
  });

  it("falls back to 62% of the gross when there is no rate", () => {
    expect(payoutFor(creator(), 4000, facts)).toBe(2500);
  });
});

describe("packagesFor", () => {
  const nova = { ...creator({ views: 100_000 }), id: "nova-ai" };
  const lena = { ...creator({ views: 50_000 }), id: "prompt-lena" };
  const quiet = { ...creator({ views: null }), id: "quiet-llm" };

  it("is empty with no creators", () => {
    expect(packagesFor([], facts)).toEqual([]);
  });

  it("offers a single, a bundle and a takeover", () => {
    expect(packagesFor([nova, lena], facts)).toEqual([
      { key: "single", price: 4000, creators: ["nova-ai"], views: 100_000 },
      { key: "bundle", price: 11_050, creators: ["nova-ai"], views: 100_000 },
      { key: "takeover", price: 8200, creators: ["nova-ai", "prompt-lena"], views: 150_000 },
    ]);
  });

  it("sums the views that are known and leaves null when none are", () => {
    expect(packagesFor([nova, quiet], facts)[2]?.views).toBe(100_000);
    const only = packagesFor([quiet], facts);
    expect(only[0]?.views).toBeNull();
    expect(only[2]?.views).toBeNull();
  });
});
