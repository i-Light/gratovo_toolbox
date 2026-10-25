import { describe, expect, it } from "vitest";

import { fitOf, fitScore, isGold } from "./fit";
import type { CatalogItem } from "./types";
import { formatCount } from "./words";

function makeItem(patch: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: "UCaaaaaaaaaaaaaaaaaaaaaa",
    name: "Prompt Lab",
    handle: "@promptlab",
    pic: null,
    stage: "new",
    emailConfirmed: false,
    email: null,
    contactName: null,
    subscribers: 100000,
    medianViews: 41000,
    uploads30: 6,
    country: "US",
    sponsors: [],
    emails: [],
    latestUploadAt: null,
    foundAt: null,
    run: null,
    keyword: null,
    videos: [],
    engagement: null,
    emailedBefore: null,
    rejectReason: null,
    rejectedAt: null,
    neverReason: null,
    archiveDueAt: null,
    archivedAt: null,
    hasNumbers: true,
    uploadsRead: true,
    ...patch,
  };
}

function part(patch: Partial<CatalogItem>, key: string) {
  const found = fitOf(makeItem(patch)).parts.find((p) => p.key === key);
  if (!found) throw new Error(`no part ${key}`);
  return found;
}

describe("formatCount", () => {
  it("shortens thousands and millions like the prototype", () => {
    expect(formatCount(950)).toBe("950");
    expect(formatCount(41000)).toBe("41K");
    expect(formatCount(1250)).toBe("1.3K");
    expect(formatCount(1000)).toBe("1K");
    expect(formatCount(1250000)).toBe("1.3M");
    expect(formatCount(2000000)).toBe("2M");
  });
});

describe("fitOf", () => {
  it("returns the five parts in order with their shares", () => {
    const fit = fitOf(makeItem());
    expect(fit.parts.map((p) => [p.key, p.of])).toEqual([
      ["median", 30],
      ["posting", 15],
      ["audience", 25],
      ["engagement", 15],
      ["sponsored", 15],
    ]);
    expect(fit.score).toBe(fit.parts.reduce((sum, p) => sum + p.points, 0));
  });

  it("scores median views up to 30 and caps at 90K", () => {
    expect(part({ medianViews: 0 }, "median").points).toBe(0);
    expect(part({ medianViews: 41000 }, "median").points).toBe(14);
    expect(part({ medianViews: 41000 }, "median").note).toBe("41K per video");
    expect(part({ medianViews: 45000 }, "median").points).toBe(15);
    expect(part({ medianViews: 90000 }, "median").points).toBe(30);
    expect(part({ medianViews: 500000 }, "median").points).toBe(30);
  });

  it("scores posting by the steps", () => {
    expect(part({ uploads30: 0 }, "posting").points).toBe(0);
    expect(part({ uploads30: 1 }, "posting").points).toBe(4);
    expect(part({ uploads30: 2 }, "posting").points).toBe(4);
    expect(part({ uploads30: 3 }, "posting").points).toBe(10);
    expect(part({ uploads30: 4 }, "posting").points).toBe(15);
    expect(part({ uploads30: 20 }, "posting").points).toBe(15);
    expect(part({ uploads30: 21 }, "posting").points).toBe(6);
  });

  it("notes the uploads and flags mostly Shorts above 20", () => {
    expect(part({ uploads30: 12 }, "posting").note).toBe("12 uploads in 30 days");
    expect(part({ uploads30: 1 }, "posting").note).toBe("1 upload in 30 days");
    expect(part({ uploads30: 40 }, "posting").note).toBe("40 uploads in 30 days (mostly Shorts)");
  });

  it("scores the audience by the channel country", () => {
    for (const country of ["US", "GB", "CA", "AU"]) {
      expect(part({ country }, "audience").points).toBe(25);
    }
    expect(part({ country: "IN" }, "audience").points).toBe(0);
    expect(part({ country: "US" }, "audience").note).toBe(
      "Channel country: US. The audience split comes with the media kit",
    );
    expect(part({ country: "IN" }, "audience").note).toContain("outside the US, UK, CA and AU");
  });

  it("scores an unknown country 0", () => {
    const audience = part({ country: null }, "audience");
    expect(audience.points).toBe(0);
    expect(audience.note).toBe("Channel country not known yet");
  });

  it("scores engagement when it is a number and caps at 6", () => {
    expect(part({ engagement: null }, "engagement")).toMatchObject({
      points: 0,
      note: "Not known yet",
    });
    expect(part({ engagement: 0 }, "engagement").points).toBe(0);
    expect(part({ engagement: 3 }, "engagement").points).toBe(8);
    expect(part({ engagement: 3 }, "engagement").note).toBe("3%");
    expect(part({ engagement: 6 }, "engagement").points).toBe(15);
    expect(part({ engagement: 9 }, "engagement").points).toBe(15);
  });

  it("gives 15 for sponsors and names them", () => {
    expect(part({ sponsors: [] }, "sponsored")).toMatchObject({
      points: 0,
      note: "No sponsors seen",
    });
    expect(part({ sponsors: ["Clipforge", "Promptly"] }, "sponsored")).toMatchObject({
      points: 15,
      note: "Clipforge, Promptly",
    });
  });

  it("names the first 3 sponsors and counts the rest", () => {
    expect(part({ sponsors: ["Clipforge", "Promptly", "Synthwave"] }, "sponsored").note).toBe(
      "Clipforge, Promptly, Synthwave",
    );
    expect(
      part({ sponsors: ["Clipforge", "Promptly", "Synthwave", "Agently", "Vectorly"] }, "sponsored")
        .note,
    ).toBe("Clipforge, Promptly, Synthwave +2 more");
  });

  it("shortens long sponsor names so the count of the rest still shows", () => {
    const long = (word: string) => `${word} AI Productivity Suite for Creators and Teams`;
    const note = part(
      { sponsors: [long("Clip"), long("Prompt"), long("Vector"), "Agently"] },
      "sponsored",
    ).note;
    expect(note.endsWith(" +1 more")).toBe(true);
    expect(note).toContain("…");
  });

  it("keeps every note to 200 characters, however long the names", () => {
    const sponsors = Array.from({ length: 50 }, (_, i) => `${String(i)}${"x".repeat(99)}`);
    const fit = fitOf(makeItem({ sponsors, country: "Z".repeat(300) }));
    for (const p of fit.parts) {
      expect(p.note.length).toBeLessThanOrEqual(200);
    }
    expect(fit.parts[4]?.note.endsWith(" +47 more")).toBe(true);
  });

  it("zeroes median and posting when there are no numbers", () => {
    const fit = fitOf(makeItem({ hasNumbers: false, medianViews: 0, uploads30: 0 }));
    expect(fit.parts[0]).toMatchObject({ points: 0, note: "No numbers yet" });
    expect(fit.parts[1]).toMatchObject({ points: 0, note: "No numbers yet" });
    expect(fit.parts[2]?.points).toBe(25);
  });

  it("adds up to 100 at the best", () => {
    const best = makeItem({
      medianViews: 90000,
      uploads30: 8,
      engagement: 6,
      sponsors: ["Clipforge"],
    });
    expect(fitOf(best).score).toBe(100);
  });
});

describe("isGold", () => {
  const gold = { medianViews: 40000, subscribers: 100000, uploads30: 3 };

  it("accepts the exact boundaries", () => {
    expect(isGold(makeItem(gold))).toBe(true);
    expect(isGold(makeItem({ ...gold, uploads30: 20 }))).toBe(true);
    expect(isGold(makeItem({ ...gold, medianViews: 40000, subscribers: 100000 }))).toBe(true);
  });

  it("needs at least 40000 median views", () => {
    expect(isGold(makeItem({ ...gold, medianViews: 39999, subscribers: 1000 }))).toBe(false);
  });

  it("needs views of at least 0.4 of the subscribers", () => {
    expect(isGold(makeItem({ ...gold, subscribers: 100000 }))).toBe(true);
    expect(isGold(makeItem({ ...gold, subscribers: 100001 }))).toBe(false);
  });

  it("needs 3 to 20 uploads", () => {
    expect(isGold(makeItem({ ...gold, uploads30: 2 }))).toBe(false);
    expect(isGold(makeItem({ ...gold, uploads30: 21 }))).toBe(false);
  });

  it("is false when the subscribers are unknown", () => {
    expect(isGold(makeItem({ ...gold, subscribers: null }))).toBe(false);
  });
});

describe("fitScore", () => {
  it("agrees with fitOf on a varied set", () => {
    const items: CatalogItem[] = [];
    for (const medianViews of [0, 12000, 41000, 90000, 500000]) {
      for (const uploads30 of [0, 1, 3, 4, 21]) {
        for (const country of [null, "US", "IN"]) {
          for (const engagement of [null, 0, 3, 9]) {
            for (const sponsors of [[], ["Clipforge"]]) {
              for (const hasNumbers of [true, false]) {
                items.push(
                  makeItem({ medianViews, uploads30, country, engagement, sponsors, hasNumbers }),
                );
              }
            }
          }
        }
      }
    }
    for (const item of items) {
      expect(fitScore(item)).toBe(fitOf(item).score);
    }
  });
});
