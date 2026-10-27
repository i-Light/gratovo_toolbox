import { describe, expect, it } from "vitest";
import type { CreatorKit, KitInput } from "../data/types";
import {
  audienceKeys,
  canSign,
  checkAudience,
  engineKit,
  kitView,
  mergeKit,
  movesToKit,
  parseAgeBand,
  signingStages,
  wakeStage,
} from "./audience";

function kit(over: Partial<CreatorKit> = {}): CreatorKit {
  const made: CreatorKit = {
    countries: [{ code: "US", share: 60 }],
    ageBand: "18-34",
    engagement: 4,
    rate: 2000,
    rateKnown: true,
    link: null,
    fromReply: false,
    ...over,
  };
  return over.rateKnown === undefined ? { ...made, rateKnown: (made.rate ?? 0) > 0 } : made;
}

const input: KitInput = {
  countries: [{ code: "US", share: 60 }],
  ageBand: "18-34",
  engagement: 4,
  rate: 2000,
  link: "https://example.com/kit.pdf",
};

describe("parseAgeBand", () => {
  it("reads a hyphen, an en dash and spaces", () => {
    expect(parseAgeBand("18-34")).toEqual({ low: 18, high: 34 });
    expect(parseAgeBand("18–34")).toEqual({ low: 18, high: 34 });
    expect(parseAgeBand("18 - 34")).toEqual({ low: 18, high: 34 });
  });

  it("refuses a bad band", () => {
    expect(parseAgeBand("34-18")).toBeNull();
    expect(parseAgeBand("20-20")).toBeNull();
    expect(parseAgeBand("12-30")).toBeNull();
    expect(parseAgeBand("20-100")).toBeNull();
    expect(parseAgeBand("young")).toBeNull();
    expect(parseAgeBand("")).toBeNull();
  });
});

describe("checkAudience", () => {
  it("passes when all four are yes", () => {
    const result = checkAudience(kit());
    expect(result.verdict).toBe("pass");
    expect(result.rows.map((row) => row.key)).toEqual([...audienceKeys]);
    expect(result.rows.every((row) => row.ok === true)).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.firstFail).toBeNull();
  });

  it("fails on a leader outside US, GB, CA, AU", () => {
    const result = checkAudience(
      kit({
        countries: [
          { code: "IN", share: 50 },
          { code: "US", share: 30 },
        ],
      }),
    );
    expect(result.verdict).toBe("fail");
    expect(result.firstFail).toBe("top");
  });

  it("fails on an age band outside 18 to 44", () => {
    expect(checkAudience(kit({ ageBand: "13-17" })).firstFail).toBe("age");
    expect(checkAudience(kit({ ageBand: "35-50" })).firstFail).toBe("age");
    expect(checkAudience(kit({ ageBand: "18-44" })).verdict).toBe("pass");
    expect(checkAudience(kit({ ageBand: "18–44" })).verdict).toBe("pass");
  });

  it("fails under 3% engagement and passes at 3", () => {
    expect(checkAudience(kit({ engagement: 2.9 })).firstFail).toBe("engagement");
    expect(checkAudience(kit({ engagement: 3 })).verdict).toBe("pass");
  });

  it("reports the first failing row and keeps missing rows apart", () => {
    const result = checkAudience(kit({ engagement: 1, ageBand: null }));
    expect(result.verdict).toBe("fail");
    expect(result.firstFail).toBe("engagement");
    expect(result.missing).toEqual(["age"]);
  });

  it("is missing when numbers are not known", () => {
    const result = checkAudience(kit({ countries: [], rate: null }));
    expect(result.verdict).toBe("missing");
    expect(result.missing).toEqual(["top", "rate"]);
  });

  it("treats a null kit as missing on every row", () => {
    const result = checkAudience(null);
    expect(result.verdict).toBe("missing");
    expect(result.rows.every((row) => row.ok === null)).toBe(true);
    expect(result.missing).toEqual([...audienceKeys]);
  });

  it("never makes the rate row a no", () => {
    expect(checkAudience(kit({ rate: 0 })).rows[3]?.ok).toBeNull();
  });
});

describe("kitView", () => {
  it("returns null for nothing", () => {
    expect(kitView(null, null, null)).toBeNull();
    expect(kitView({}, {}, null)).toBeNull();
    expect(kitView("x", 5, null)).toBeNull();
    expect(kitView([], [], null)).toBeNull();
  });

  it("reads a typed kit", () => {
    const view = kitView(
      {
        countries: [
          { code: "gb", pct: 20 },
          { code: "us", pct: 55 },
        ],
        ageBand: "18–34",
        engagement: 5,
        link: "https://x.test/kit",
        rates: [{ format: "integration", price: 1500 }],
      },
      null,
      null,
    );
    expect(view).toEqual({
      countries: [
        { code: "US", share: 55 },
        { code: "GB", share: 20 },
      ],
      ageBand: "18-34",
      engagement: 5,
      rate: 1500,
      rateKnown: true,
      link: "https://x.test/kit",
      fromReply: false,
    });
  });

  it("falls back to the reply field by field and flags fromReply", () => {
    const view = kitView(
      null,
      { rate: 900, countries: [{ code: "ca", share: 40 }], age: "25-34" },
      3.5,
    );
    expect(view).toEqual({
      countries: [{ code: "CA", share: 40 }],
      ageBand: "25-34",
      engagement: 3.5,
      rate: 900,
      rateKnown: true,
      link: null,
      fromReply: true,
    });
  });

  it("takes the typed field over the reply's, others from the reply", () => {
    const view = kitView({ ageBand: "20-30" }, { rate: 900, age: "25-34" }, null);
    expect(view?.ageBand).toBe("20-30");
    expect(view?.rate).toBe(900);
    expect(view?.fromReply).toBe(false);
  });

  it("prefers the integration row, then the first row, then the reply's rate", () => {
    const rows = [
      { format: "shorts", price: 300 },
      { format: "integration", price: 1200 },
    ];
    expect(kitView({ rates: rows }, { rate: 5 }, null)?.rate).toBe(1200);
    expect(kitView({ rates: [rows[0]] }, { rate: 5 }, null)?.rate).toBe(300);
    expect(kitView({ rates: [{ format: "x", price: "no" }] }, { rate: 5 }, null)?.rate).toBe(5);
  });

  it("prefers the kit's engagement over the argument", () => {
    expect(kitView({ engagement: 6 }, null, 2)?.engagement).toBe(6);
    expect(kitView({ engagement: "high" }, null, 2)?.engagement).toBe(2);
  });

  it("keeps a link only when it is https", () => {
    expect(kitView({ link: "http://x.test", engagement: 1 }, null, null)?.link).toBeNull();
    expect(kitView({ link: "javascript:alert(1)", engagement: 1 }, null, null)?.link).toBeNull();
    expect(kitView({ link: "https://x.test" }, null, null)?.link).toBe("https://x.test");
  });

  it("keeps null shares last, ties in order, and at most five", () => {
    const view = kitView(
      null,
      {
        countries: [
          { code: "AA", share: null },
          { code: "BB", share: 10 },
          { code: "CC", share: 10 },
          { code: "DD", share: 30 },
          { code: "EE", share: 5 },
          { code: "FF", share: 1 },
        ],
      },
      null,
    );
    expect(view?.countries.map((one) => one.code)).toEqual(["DD", "BB", "CC", "EE", "FF"]);
  });

  it("treats bad fields as absent", () => {
    const view = kitView(
      {
        countries: [{ code: 5, pct: 3 }, null, { code: "US", pct: "x" }],
        ageBand: 30,
        engagement: Number.NaN,
        rates: "none",
        link: 7,
      },
      { rate: -4, countries: "US", age: "old" },
      null,
    );
    expect(view).toEqual({
      countries: [{ code: "US", share: null }],
      ageBand: null,
      engagement: null,
      rate: null,
      rateKnown: false,
      link: null,
      fromReply: false,
    });
  });

  it("is not fromReply when the kit gives a rate", () => {
    const view = kitView(
      { rates: [{ format: "integration", price: 100 }] },
      { age: "20-30" },
      null,
    );
    expect(view?.fromReply).toBe(false);
  });
});

describe("mergeKit", () => {
  it("builds a kit from nothing", () => {
    expect(mergeKit(null, input)).toEqual({
      countries: [{ code: "US", pct: 60 }],
      ageBand: "18-34",
      engagement: 4,
      link: "https://example.com/kit.pdf",
      rates: [{ format: "integration", price: 2000 }],
    });
  });

  it("keeps unknown keys and other rate rows", () => {
    const stored = {
      note: "keep me",
      rates: [
        { format: "shorts", price: 300 },
        { format: "integration", price: 1000, agreed: true },
      ],
    };
    const merged = mergeKit(stored, { ...input, rate: 2500 });
    expect(merged["note"]).toBe("keep me");
    expect(merged["rates"]).toEqual([
      { format: "shorts", price: 300 },
      { format: "integration", price: 2500 },
    ]);
    expect(stored.rates[1]).toEqual({ format: "integration", price: 1000, agreed: true });
  });

  it("keeps agreed only when the price is unchanged", () => {
    const stored = { rates: [{ format: "integration", price: 2000, agreed: true }] };
    expect(mergeKit(stored, input)["rates"]).toEqual([
      { format: "integration", price: 2000, agreed: true },
    ]);
  });

  it("removes keys whose input is empty", () => {
    const stored = {
      countries: [{ code: "US", pct: 1 }],
      ageBand: "18-30",
      engagement: 2,
      link: "https://x.test",
      rates: [{ format: "integration", price: 10 }],
      other: 1,
    };
    const merged = mergeKit(stored, {
      countries: [],
      ageBand: null,
      engagement: null,
      rate: null,
      link: null,
    });
    expect(merged).toEqual({ other: 1 });
  });

  it("keeps other rows when the rate is removed", () => {
    const stored = {
      rates: [
        { format: "integration", price: 10 },
        { format: "shorts", price: 5 },
      ],
    };
    expect(mergeKit(stored, { ...input, rate: null })["rates"]).toEqual([
      { format: "shorts", price: 5 },
    ]);
  });

  it("copes with a stored value that is not an object", () => {
    expect(mergeKit("junk", input)["ageBand"]).toBe("18-34");
    expect(mergeKit([1], input)["ageBand"]).toBe("18-34");
  });
});

describe("engineKit", () => {
  it("is null without a view", () => {
    expect(engineKit(null, true)).toBeNull();
  });

  it("writes the legacy shape and marks the rate agreed when signed", () => {
    expect(engineKit(kit({ link: "https://x.test" }), true)).toEqual({
      countries: [{ code: "US", pct: 60 }],
      ageBand: "18-34",
      engagement: 4,
      link: "https://x.test",
      rates: [{ format: "integration", price: 2000, agreed: true }],
    });
    expect(engineKit(kit(), false)?.["rates"]).toEqual([
      { format: "integration", price: 2000, agreed: false },
    ]);
  });

  it("has no rate row when the rate is unknown", () => {
    expect(engineKit(kit({ rate: null }), true)?.["rates"]).toEqual([]);
  });
});

describe("movesToKit", () => {
  it("needs replied, a rate and a country", () => {
    expect(movesToKit("replied", kit())).toBe(true);
    expect(movesToKit("replied", kit({ rate: null }))).toBe(false);
    expect(movesToKit("replied", kit({ countries: [] }))).toBe(false);
    expect(movesToKit("replied", null)).toBe(false);
    expect(movesToKit("emailed", kit())).toBe(false);
    expect(movesToKit("kit", kit())).toBe(false);
  });
});

describe("canSign", () => {
  it("needs kit or audience and a pass", () => {
    expect(canSign("kit", kit())).toBe(true);
    expect(canSign("audience", kit())).toBe(true);
    expect(canSign("replied", kit())).toBe(false);
    expect(canSign("signed", kit())).toBe(false);
    expect(canSign("kit", kit({ engagement: 1 }))).toBe(false);
    expect(canSign("kit", kit({ rate: null }))).toBe(false);
    expect(canSign("kit", null)).toBe(false);
  });
});

describe("wakeStage", () => {
  it("wakes a sequence stopped by anything to kit when the numbers are there", () => {
    expect(wakeStage("replied", kit(), true)).toBe("kit");
    expect(wakeStage("finished", kit(), false)).toBe("kit");
    expect(wakeStage("you", kit(), true)).toBe("kit");
  });

  it("wakes to replied only when there was a reply and no numbers", () => {
    expect(wakeStage("replied", kit({ rate: null }), true)).toBe("replied");
    expect(wakeStage("replied", kit({ countries: [] }), true)).toBe("replied");
    expect(wakeStage("replied", null, true)).toBe("replied");
    expect(wakeStage("finished", null, true)).toBe("replied");
    expect(wakeStage("you", null, true)).toBe("replied");
  });

  it("wakes to emailed without a reply and without numbers", () => {
    expect(wakeStage("replied", null, false)).toBe("emailed");
    expect(wakeStage("finished", kit({ rate: null }), false)).toBe("emailed");
    expect(wakeStage("you", null, false)).toBe("emailed");
    expect(wakeStage("bounced", null, false)).toBe("emailed");
  });

  it("wakes a sequence that never stopped to emailed", () => {
    expect(wakeStage(null, kit(), true)).toBe("emailed");
  });
});

describe("rateKnown", () => {
  it("counts a hidden but stored rate in the check and the moves", () => {
    const hidden = kit({ rate: null, rateKnown: true });
    expect(checkAudience(hidden).rows[3]?.ok).toBe(true);
    expect(movesToKit("replied", hidden)).toBe(true);
    expect(canSign("kit", hidden)).toBe(true);
    expect(wakeStage("replied", hidden, true)).toBe("kit");
  });
});

describe("kitView with a hostile stored kit", () => {
  it("sanitises every field", () => {
    const view = kitView(
      {
        countries: [
          { code: "United States", pct: 50 },
          { code: "uk", pct: 120 },
          { code: "ca", pct: -5 },
          { code: "au", pct: Number.NaN },
          { code: { nested: 1 }, pct: 3 },
        ],
        ageBand: { nested: true },
        engagement: 250,
        rates: [{ format: "integration", price: 5_000_000.4 }],
        link: `https://${"a".repeat(3000)}`,
      },
      null,
      -5,
    );
    expect(view?.countries).toEqual([
      { code: "GB", share: null },
      { code: "CA", share: null },
      { code: "AU", share: null },
    ]);
    expect(view?.engagement).toBeNull();
    expect(view?.rate).toBe(1_000_000);
    expect(view?.link).toBeNull();
  });

  it("rounds a rate to whole dollars and drops one that is not positive", () => {
    expect(kitView({ rates: [{ format: "integration", price: 99.6 }] }, null, null)?.rate).toBe(
      100,
    );
    expect(kitView({ rates: [{ format: "integration", price: 0.2 }] }, null, null)).toBeNull();
    expect(kitView({ rates: [{ format: "integration", price: Infinity }] }, null, null)).toBeNull();
  });
});

describe("mergeKit with omitted fields", () => {
  it("leaves the stored values as they are", () => {
    const stored = {
      countries: [{ code: "US", pct: 60 }],
      ageBand: "18-34",
      engagement: 4,
      link: "https://example.com/k",
      rates: [{ format: "integration", price: 900, agreed: true }],
    };
    expect(mergeKit(stored, {})).toEqual(stored);
    expect(mergeKit(stored, { ageBand: null })["ageBand"]).toBeUndefined();
    expect(mergeKit(stored, { ageBand: null })["rates"]).toEqual(stored.rates);
  });
});

describe("signingStages", () => {
  it("lists replied, kit and audience", () => {
    expect(signingStages).toEqual(["replied", "kit", "audience"]);
  });
});
