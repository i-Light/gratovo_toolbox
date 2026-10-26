import { describe, expect, it } from "vitest";

import { ownWords, readAgeBand, readCountries, readRate, readReplyFacts } from "./reply-facts";

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

describe("what the review of 6d found", () => {
  it("never reads our own quoted email as theirs", () => {
    const reply = [
      "Sounds interesting, tell me more.",
      "",
      "On Mon, 26 Oct 2026 at 10:00, Moustafa <outreach1@gratovo.example> wrote:",
      "> Brands pay $5,000 for an integration. Your US audience is a great fit.",
    ].join("\n");
    expect(ownWords(reply)).toBe("Sounds interesting, tell me more.\n");
    expect(readReplyFacts(reply)).toEqual([]);
    expect(readRate("Fine by me.\n> We pay $3,000\n")).toBeNull();
  });

  it("reads US and UK only as written, and never from America or a lower-case 'us'", () => {
    expect(readCountries("Let us know which brand. My subscribers love tools.")).toEqual([]);
    expect(readCountries("My audience is mostly South America and Latin America")).toEqual([]);
    expect(readCountries("Top viewers: the US and the UK").map((c) => c.code)).toEqual([
      "US",
      "GB",
    ]);
  });

  it("reads a share written as '40% of viewers in Germany'", () => {
    expect(readCountries("About 40% of viewers in Germany, the rest US")).toEqual([
      { code: "DE", share: 40 },
      { code: "US", share: null },
    ]);
  });

  it("never reads a percentage or an engagement rate as a price, and reads 'Rate: 900'", () => {
    expect(readRate("My engagement rate is 30%")).toBeNull();
    expect(readRate("My engagement rate is 30 percent")).toBeNull();
    expect(readRate("My fee is 50% upfront")).toBeNull();
    expect(readRate("Open rate 45, click rate 20")).toBeNull();
    expect(readRate("Rate: 900")).toBe(900);
  });

  it("reads no age band from a length of time", () => {
    expect(readAgeBand("My videos are 20-30 minutes long and top viewers stay")).toBeNull();
    expect(readAgeBand("Viewers: aged 18-24 mostly")).toBe("18-24");
  });
});
