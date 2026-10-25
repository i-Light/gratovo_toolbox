import { describe, expect, it } from "vitest";

import { readAgeBand, readCountries, readRate, readReplyFacts } from "./reply-facts";

describe("readRate", () => {
  it("reads a dollar amount, with commas, cents or a k", () => {
    expect(readRate("My rate is $1,200 for a dedicated video.")).toBe(1200);
    expect(readRate("Usually $850.00 per integration")).toBe(850);
    expect(readRate("Integrations start at $2.5k")).toBe(2500);
    expect(readRate("I charge 1500 USD")).toBe(1500);
  });

  it("reads a bare number only right after a price word", () => {
    expect(readRate("my rate is 900")).toBe(900);
    expect(readRate("I posted 900 videos and 12 shorts")).toBeNull();
  });

  it("skips amounts that can't be a rate", () => {
    expect(readRate("We spent $5 on coffee")).toBeNull();
    expect(readRate("No numbers here.")).toBeNull();
  });
});

describe("readCountries", () => {
  it("reads top countries with their shares, largest first", () => {
    expect(readCountries("My audience: US 45%, UK 20%, Canada (8%).")).toEqual([
      { code: "US", share: 45 },
      { code: "GB", share: 20 },
      { code: "CA", share: 8 },
    ]);
  });

  it("reads a share written before the name, and names with no share", () => {
    expect(readCountries("About 60% from the United States, the rest mostly India")).toEqual([
      { code: "US", share: 60 },
      { code: "IN", share: null },
    ]);
  });

  it("reads nothing without words about the audience", () => {
    expect(readCountries("I'm flying to Canada next week.")).toEqual([]);
  });

  it("keeps at most five", () => {
    const text = "Top countries: US 30%, UK 15%, Canada 10%, Australia 9%, Germany 8%, India 7%";
    expect(readCountries(text).map((c) => c.code)).toEqual(["US", "GB", "CA", "AU", "DE"]);
  });
});

describe("readAgeBand", () => {
  it("reads an age band about the audience", () => {
    expect(readAgeBand("Most viewers are 25-34")).toBe("25-34");
    expect(readAgeBand("my audience is mostly 18 to 24")).toBe("18-24");
  });

  it("reads no band from shares or out-of-range numbers", () => {
    expect(readAgeBand("audience: US 45-50%")).toBeNull();
    expect(readAgeBand("viewers 70-90")).toBeNull();
    expect(readAgeBand("See you 25-34 days from now")).toBeNull();
  });
});

describe("readReplyFacts", () => {
  it("gives each fact found, none saved", () => {
    const text =
      "Thanks! My rate is $1,200. Audience from YouTube Studio: US 45%, UK 20%. Mostly 25-34.";
    expect(readReplyFacts(text)).toEqual([
      { key: "rate", rate: 1200, saved: false },
      {
        key: "countries",
        countries: [
          { code: "US", share: 45 },
          { code: "GB", share: 20 },
        ],
        saved: false,
      },
      { key: "age", band: "25-34", saved: false },
    ]);
    expect(readReplyFacts("Sounds good, tell me more.")).toEqual([]);
  });
});
