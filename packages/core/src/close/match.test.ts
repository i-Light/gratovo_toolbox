import { describe, expect, it } from "vitest";
import { bareBrand, bareDeal, defaultAgencyFacts as facts } from "../data";
import type { Brand, Deal } from "../data";
import type { MatchCreator, MatchWorld } from "./engine-types";
import { bestBrandFor, matchOf } from "./match";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

function brand(id: string, over: Partial<Brand> = {}): Brand {
  return {
    ...bareBrand({ id, name: id, sells: "AI tools", status: "qualified" }),
    ...over,
  };
}

function deal(id: string, brandId: string, step: number, creator = "nova-ai"): Deal {
  return bareDeal({ id, brand: brandId, creator, step, price: null });
}

function creator(over: Partial<MatchCreator> = {}): MatchCreator {
  return {
    id: "nova-ai",
    name: "Nova AI",
    views: 100_000,
    rate: null,
    relationship: null,
    fit: 50,
    sponsors: [],
    countries: [],
    locks: [],
    dreamBrands: [],
    ...over,
  };
}

function world(brands: Brand[], deals: Deal[] = []): MatchWorld {
  return { brands, deals, now: NOW, facts };
}

describe("matchOf", () => {
  it("scores 60% of the fit when nothing else applies, and clamps to 0..100", () => {
    const b = brand("CodePilot");
    expect(matchOf(b, creator(), world([b]))).toEqual({
      score: 30,
      why: [],
      warn: [],
      price: 4000,
    });
    expect(matchOf(b, creator({ fit: null }), world([b])).score).toBe(0);
    const low = matchOf(b, creator({ fit: 0, sponsors: ["CodePilot"] }), world([b]));
    expect(low.score).toBe(0);
    const high = brand("Hi", { country: "US", budget: { low: 1, high: 9999 } });
    const m = matchOf(
      high,
      creator({ fit: 100, dreamBrands: ["Hi"], countries: [{ code: "US", share: 80 }] }),
      world([high]),
    );
    expect(m.score).toBe(92);
    const won = { ...high, status: "won" } as const;
    const over = matchOf(
      won,
      creator({
        fit: 100,
        sponsors: ["Hi"],
        dreamBrands: ["Hi"],
        countries: [{ code: "US", share: 80 }],
      }),
      world([won]),
    );
    expect(over.score).toBe(100);
  });

  it("rewards a repeat fit when the brand is won or a deal exists", () => {
    const won = brand("VoiceForge", { status: "won" });
    expect(matchOf(won, creator({ sponsors: ["VoiceForge"] }), world([won])).why).toEqual([
      { kind: "repeat" },
    ]);
    const b = brand("ChatLoop");
    const past = matchOf(
      b,
      creator({ sponsors: ["ChatLoop"] }),
      world([b], [deal("d1", "ChatLoop", 9)]),
    );
    expect(past.score).toBe(45);
    expect(past.why).toEqual([{ kind: "repeat" }]);
    expect(past.warn).toEqual([]);
  });

  it("warns when the creator was sponsored by the brand directly before", () => {
    const b = brand("ChatLoop");
    const m = matchOf(b, creator({ sponsors: ["ChatLoop"] }), world([b], [deal("d1", "Other", 9)]));
    expect(m.score).toBe(20);
    expect(m.warn).toEqual([{ kind: "sponsoredDirect" }]);
  });

  it("ignores a deal between the brand and a different creator", () => {
    const b = brand("ChatLoop");
    const m = matchOf(
      b,
      creator({ sponsors: ["ChatLoop"] }),
      world([b], [deal("d1", "ChatLoop", 9, "other")]),
    );
    expect(m.warn).toEqual([{ kind: "sponsoredDirect" }]);
  });

  it("warns of an active exclusivity lock in the category", () => {
    const b = brand("CodePilot", { category: "code" });
    const lock = { category: "code", brand: "RivalCode", until: NOW + DAY };
    const m = matchOf(b, creator({ locks: [lock] }), world([b]));
    expect(m.score).toBe(5);
    expect(m.warn).toEqual([
      { kind: "lock", category: "code", brand: "RivalCode", until: NOW + DAY },
    ]);
  });

  it("does not warn of a lock that is over, in another category, held by the brand itself, or when the brand has no category", () => {
    const b = brand("CodePilot", { category: "code" });
    const locks = [
      { category: "code", brand: "RivalCode", until: NOW - 1 },
      { category: "voice", brand: "RivalVoice", until: NOW + DAY },
      { category: "code", brand: "codepilot", until: NOW + DAY },
    ];
    expect(matchOf(b, creator({ locks }), world([b])).warn).toEqual([]);
    const none = brand("Plain");
    const any = [{ category: "code", brand: "RivalCode", until: NOW + DAY }];
    expect(matchOf(none, creator({ locks: any }), world([none])).warn).toEqual([]);
  });

  it("warns of a competitor sponsor in the same category, case-insensitively, unless a lock applies", () => {
    const b = brand("CodePilot", { category: "code" });
    const rival = brand("RivalCode", { category: "code" });
    const voice = brand("VoiceForge", { category: "voice" });
    const w = world([b, rival, voice]);
    const m = matchOf(b, creator({ sponsors: ["rivalcode"] }), w);
    expect(m.score).toBe(18);
    expect(m.warn).toEqual([{ kind: "competitor", brand: "rivalcode" }]);
    expect(matchOf(b, creator({ sponsors: ["VoiceForge", "Unknown"] }), w).warn).toEqual([]);
    const locked = matchOf(
      b,
      creator({
        sponsors: ["RivalCode"],
        locks: [{ category: "code", brand: "RivalCode", until: NOW + DAY }],
      }),
      w,
    );
    expect(locked.warn.map((x) => x.kind)).toEqual(["lock"]);
  });

  it("never finds a competitor for a brand with no category", () => {
    const b = brand("Plain");
    const other = brand("Other");
    expect(matchOf(b, creator({ sponsors: ["Other"] }), world([b, other])).warn).toEqual([]);
  });

  it("adds points for a dream brand", () => {
    const b = brand("CodePilot");
    const m = matchOf(b, creator({ dreamBrands: ["CodePilot"] }), world([b]));
    expect(m.score).toBe(40);
    expect(m.why).toEqual([{ kind: "dream" }]);
  });

  it("rewards a US-led audience for a US brand", () => {
    const b = brand("CodePilot", { country: "US" });
    const m = matchOf(b, creator({ countries: [{ code: "US", share: 30 }] }), world([b]));
    expect(m.why).toEqual([{ kind: "usLed" }]);
    expect(m.score).toBe(40);
  });

  it("rewards a strong US/UK/CA/AU share otherwise, counting only the top 3 and null as 0", () => {
    const b = brand("CodePilot", { country: "FR" });
    const countries = [
      { code: "GB", share: 30 },
      { code: "IN", share: 20 },
      { code: "CA", share: 25 },
      { code: "AU", share: 40 },
    ];
    expect(matchOf(b, creator({ countries }), world([b])).why).toEqual([
      { kind: "share", pct: 55 },
    ]);
    const nulls = [
      { code: "GB", share: null },
      { code: "US", share: 30 },
    ];
    expect(matchOf(b, creator({ countries: nulls }), world([b])).why).toEqual([]);
    const usBrandLedByGb = brand("US Co", { country: "US" });
    const m = matchOf(
      usBrandLedByGb,
      creator({ countries: [{ code: "GB", share: 60 }] }),
      world([usBrandLedByGb]),
    );
    expect(m.why).toEqual([{ kind: "share", pct: 60 }]);
  });

  it("checks the quote against the budget", () => {
    const fits = brand("Fits", { budget: { low: 3000, high: 5000 } });
    const m = matchOf(fits, creator(), world([fits]));
    expect(m.why).toEqual([{ kind: "budgetFits", price: 4000, low: 3000, high: 5000 }]);
    expect(m.score).toBe(42);
    const small = brand("Small", { budget: { low: 500, high: 2000 } });
    expect(matchOf(small, creator(), world([small])).warn).toEqual([
      { kind: "overBudget", price: 4000, high: 2000 },
    ]);
  });

  it("warns of a live deal with another brand of the same category", () => {
    const b = brand("CodePilot", { category: "code" });
    const rival = brand("RivalCode", { category: "code" });
    const voice = brand("VoiceForge", { category: "voice" });
    const w = world([b, rival, voice], [deal("d1", "RivalCode", 4), deal("d2", "VoiceForge", 7)]);
    const m = matchOf(b, creator(), w);
    expect(m.score).toBe(0);
    expect(m.warn).toEqual([{ kind: "liveClash", brandId: "RivalCode" }]);
  });

  it("ignores finished deals, deals with the same brand, other creators' deals and unknown brands", () => {
    const b = brand("CodePilot", { category: "code" });
    const rival = brand("RivalCode", { category: "code" });
    const w = world(
      [b, rival],
      [
        deal("d1", "RivalCode", 9),
        deal("d2", "CodePilot", 7),
        deal("d3", "RivalCode", 4, "other"),
        deal("d4", "Ghost", 4),
      ],
    );
    expect(matchOf(b, creator(), w).warn).toEqual([]);
    const plain = brand("Plain");
    expect(
      matchOf(plain, creator(), world([plain, rival], [deal("d1", "RivalCode", 4)])).warn,
    ).toEqual([]);
  });

  it("warns when two or more deals are before go-live", () => {
    const b = brand("CodePilot");
    const one = world([b], [deal("d1", "A", 0)]);
    expect(matchOf(b, creator(), one).warn).toEqual([]);
    const two = world([b], [deal("d1", "A", 0), deal("d2", "B", 5), deal("d3", "C", 6)]);
    expect(matchOf(b, creator(), two).warn).toEqual([{ kind: "busy", deals: 2 }]);
  });
});

describe("bestBrandFor", () => {
  it("returns null when no brand is qualified or won, or all have warnings", () => {
    const found = brand("Found", { status: "found" });
    expect(bestBrandFor(creator(), world([found]))).toBeNull();
    const small = brand("Small", { budget: { low: 1, high: 100 } });
    expect(bestBrandFor(creator(), world([small]))).toBeNull();
    expect(bestBrandFor(creator(), world([]))).toBeNull();
  });

  it("picks the best score among qualified and won brands, the first of equals", () => {
    const a = brand("Alpha");
    const b = brand("Beta", { status: "won", budget: { low: 1, high: 9000 } });
    const c = brand("Gamma", { budget: { low: 1, high: 9000 } });
    const lost = brand("Lost", { status: "lost", budget: { low: 1, high: 9000 } });
    const best = bestBrandFor(creator(), world([a, b, c, lost]));
    expect(best?.brandId).toBe("Beta");
    expect(best?.match.score).toBe(42);
    expect(bestBrandFor(creator(), world([a, brand("Alpha2")]))?.brandId).toBe("Alpha");
  });
});
