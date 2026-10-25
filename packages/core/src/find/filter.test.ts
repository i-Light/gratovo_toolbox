import { describe, expect, it } from "vitest";

import { facetCounts, hasSignal, passes, queryCatalog, sortItems } from "./filter";
import { emptyFacets, emptyFindFilter, type CatalogItem, type FindFilter } from "./types";

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

function filterWith(patch: Partial<FindFilter>): FindFilter {
  return { ...emptyFindFilter, ...patch };
}

function video(title: string) {
  return { id: "v", title, views: null, publishedAt: null, pic: null };
}

// Fit scores, worked out by hand: a 72, f 66, c 45, b 36, e 30, d 32.
const a = makeItem({
  id: "a",
  name: "Prompt Lab",
  handle: "@promptlab",
  medianViews: 50000,
  subscribers: 100000,
  uploads30: 6,
  country: "US",
  sponsors: ["Clipforge"],
  run: 1,
  foundAt: 300,
  latestUploadAt: 30,
  videos: [video("Ten Claude tricks")],
});
const b = makeItem({
  id: "b",
  name: "Agent Weekly",
  handle: "@agentweekly",
  stage: "shortlisted",
  medianViews: 20000,
  subscribers: 30000,
  uploads30: 2,
  country: "GB",
  email: "hello@agentweekly.ai",
  emailConfirmed: true,
  run: 1,
  foundAt: 200,
  latestUploadAt: 10,
});
const c = makeItem({
  id: "c",
  name: "Model Daily",
  handle: "@modeldaily",
  medianViews: 90000,
  subscribers: 1000000,
  uploads30: 10,
  country: "IN",
  emails: [
    { email: "biz@modeldaily.ai", source: "about", videos: 0, business: true, confidence: 0.95 },
    {
      email: "modeldaily@gmail.com",
      source: "video",
      videos: 2,
      business: false,
      confidence: 0.55,
    },
  ],
  run: 2,
  foundAt: 100,
  latestUploadAt: 20,
});
const d = makeItem({
  id: "d",
  name: "Old Bot News",
  handle: "@oldbot",
  stage: "rejected",
  medianViews: 10000,
  subscribers: 5000,
  uploads30: 1,
  country: "US",
  run: 2,
});
const e = makeItem({
  id: "e",
  name: "Chip Brief",
  handle: "@chipbrief",
  stage: "emailed",
  medianViews: 45000,
  subscribers: null,
  uploads30: 4,
  country: null,
  email: "chip@brief.ai",
  emailedBefore: { at: 5, who: "Sam" },
  run: null,
  foundAt: null,
  latestUploadAt: null,
});
const f = makeItem({
  id: "f",
  name: "Shorts Machine",
  handle: "@shortsmachine",
  medianViews: 60000,
  subscribers: 100000,
  uploads30: 25,
  country: "US",
  sponsors: ["Promptly"],
  run: 2,
  foundAt: 400,
  latestUploadAt: 40,
});
const all = [a, b, c, d, e, f];
const ids = (items: readonly CatalogItem[]) => items.map((item) => item.id);

describe("hasSignal", () => {
  it("gold follows isGold", () => {
    expect(hasSignal(a, "gold")).toBe(true);
    expect(hasSignal(c, "gold")).toBe(false);
  });

  it("sponsored needs a sponsor", () => {
    expect(hasSignal(a, "sponsored")).toBe(true);
    expect(hasSignal(b, "sponsored")).toBe(false);
  });

  it("email counts a stored address or a found one", () => {
    expect(hasSignal(b, "email")).toBe(true);
    expect(hasSignal(c, "email")).toBe(true);
    expect(hasSignal(a, "email")).toBe(false);
  });

  it("confirmed follows emailConfirmed", () => {
    expect(hasSignal(b, "confirmed")).toBe(true);
    expect(hasSignal(c, "confirmed")).toBe(false);
  });

  it("fresh is false once emailed before or past the email stage", () => {
    expect(hasSignal(a, "fresh")).toBe(true);
    expect(hasSignal(makeItem({ emailedBefore: { at: null, who: null } }), "fresh")).toBe(false);
    for (const stage of ["emailed", "replied", "kit", "audience", "signed"] as const) {
      expect(hasSignal(makeItem({ stage }), "fresh")).toBe(false);
    }
    expect(hasSignal(makeItem({ stage: "parked" }), "fresh")).toBe(true);
  });
});

describe("passes", () => {
  it("hides rejected and never by default", () => {
    expect(passes(d, emptyFindFilter)).toBe(false);
    expect(passes(makeItem({ stage: "never" }), emptyFindFilter)).toBe(false);
    expect(passes(a, emptyFindFilter)).toBe(true);
  });

  it("shows rejected when asked for it", () => {
    expect(passes(d, filterWith({ stages: ["rejected"] }))).toBe(true);
    expect(passes(a, filterWith({ stages: ["rejected"] }))).toBe(false);
  });

  it("skip stages lets rejected through", () => {
    expect(passes(d, emptyFindFilter, "stages")).toBe(true);
    expect(passes(a, filterWith({ stages: ["rejected"] }), "stages")).toBe(true);
  });

  it("signals must all match, and skip signals ignores them", () => {
    const filter = filterWith({ signals: ["gold", "sponsored"] });
    expect(passes(a, filter)).toBe(true);
    expect(passes(f, filter)).toBe(false);
    expect(passes(f, filter, "signals")).toBe(true);
  });

  it("countries match the channel country", () => {
    const filter = filterWith({ countries: ["US", "GB"] });
    expect(passes(a, filter)).toBe(true);
    expect(passes(c, filter)).toBe(false);
    expect(passes(e, filter)).toBe(false);
    expect(passes(c, filter, "countries")).toBe(true);
  });

  it("median uses both bounds", () => {
    const filter = filterWith({ minMedian: 45000, maxMedian: 60000 });
    expect(passes(e, filter)).toBe(true);
    expect(passes(f, filter)).toBe(true);
    expect(passes(b, filter)).toBe(false);
    expect(passes(c, filter)).toBe(false);
    expect(passes(c, filter, "median")).toBe(true);
  });

  it("uploads uses the minimum", () => {
    const filter = filterWith({ minUploads: 5 });
    expect(passes(a, filter)).toBe(true);
    expect(passes(b, filter)).toBe(false);
    expect(passes(b, filter, "uploads")).toBe(true);
  });

  it("runs match the run id and leave out items with no run", () => {
    const filter = filterWith({ runs: [1] });
    expect(passes(a, filter)).toBe(true);
    expect(passes(c, filter)).toBe(false);
    expect(passes(e, filter)).toBe(false);
    expect(passes(c, filter, "runs")).toBe(true);
  });

  it("free text matches name, handle, video titles, sponsors and email, trimmed and lowercase", () => {
    expect(passes(a, filterWith({ q: "  PROMPT lab " }))).toBe(true);
    expect(passes(a, filterWith({ q: "@promptlab" }))).toBe(true);
    expect(passes(a, filterWith({ q: "claude tricks" }))).toBe(true);
    expect(passes(a, filterWith({ q: "clipforge" }))).toBe(true);
    expect(passes(b, filterWith({ q: "agentweekly.ai" }))).toBe(true);
    expect(passes(a, filterWith({ q: "nothing like it" }))).toBe(false);
    expect(passes(a, filterWith({ q: "   " }))).toBe(true);
  });
});

describe("sortItems", () => {
  it("fit puts the best score first", () => {
    expect(ids(sortItems([b, c, a, e, f], "fit"))).toEqual(["a", "f", "c", "b", "e"]);
  });

  it("median is largest first", () => {
    expect(ids(sortItems([b, c, a, e, f], "median"))).toEqual(["c", "f", "a", "e", "b"]);
  });

  it("subs is largest first with unknown last", () => {
    expect(ids(sortItems([e, b, c, a], "subs"))).toEqual(["c", "a", "b", "e"]);
  });

  it("found is newest first with unknown last", () => {
    expect(ids(sortItems([e, c, a, f, b], "found"))).toEqual(["f", "a", "b", "c", "e"]);
  });

  it("latest is newest first with unknown last", () => {
    expect(ids(sortItems([e, c, a, f, b], "latest"))).toEqual(["f", "a", "c", "b", "e"]);
  });

  it("triage puts gold first, then fit", () => {
    const lowGold = makeItem({
      id: "g",
      medianViews: 40000,
      subscribers: 100000,
      uploads30: 3,
      country: null,
    });
    // a and g are gold (a fits better), then f (66) before c (45)
    expect(ids(sortItems([c, f, lowGold, a], "triage"))).toEqual(["a", "g", "f", "c"]);
  });

  it("keeps the input order on ties, then falls back to the id", () => {
    const x = makeItem({ id: "x", medianViews: 1000 });
    const y = makeItem({ id: "y", medianViews: 1000 });
    expect(ids(sortItems([y, x], "median"))).toEqual(["y", "x"]);
    expect(ids(sortItems([x, y], "median"))).toEqual(["x", "y"]);
    const n1 = makeItem({ id: "n1", subscribers: null });
    const n2 = makeItem({ id: "n2", subscribers: null });
    expect(ids(sortItems([n2, n1], "subs"))).toEqual(["n2", "n1"]);
  });

  it("does not change the input", () => {
    const input = [b, a];
    sortItems(input, "median");
    expect(ids(input)).toEqual(["b", "a"]);
  });
});

describe("facetCounts", () => {
  it("counts every option with the default filter", () => {
    const facets = facetCounts(all, emptyFindFilter);
    expect(facets.stages).toEqual({
      new: 3,
      shortlisted: 1,
      contact: 0,
      emailed: 1,
      replied: 0,
      kit: 0,
      audience: 0,
      signed: 0,
      rejected: 1,
      parked: 0,
      never: 0,
    });
    expect(facets.signals).toEqual({ gold: 1, sponsored: 2, email: 3, confirmed: 1, fresh: 4 });
    expect(facets.countries).toEqual({ US: 2, GB: 1, IN: 1 });
    expect(facets.runs).toEqual({ "1": 2, "2": 2 });
  });

  it("leaves a facet's own selection out of its counts", () => {
    const facets = facetCounts(all, filterWith({ countries: ["US"], runs: [2], stages: ["new"] }));
    // countries ignore the country pick but keep run 2 and stage new: c (IN), f (US)
    expect(facets.countries).toEqual({ US: 1, GB: 0, IN: 1 });
    // runs ignore the run pick but keep US and new: a (run 1), f (run 2)
    expect(facets.runs).toEqual({ "1": 1, "2": 1 });
    // stages ignore the stage pick but keep US and run 2: d rejected, f new
    expect(facets.stages.new).toBe(1);
    expect(facets.stages.rejected).toBe(1);
    expect(facets.stages.shortlisted).toBe(0);
  });

  it("counts a signal with the other selected signals plus this one", () => {
    const facets = facetCounts(all, filterWith({ signals: ["sponsored"] }));
    // sponsored: a, f. gold with it: a. email with it: none. fresh with it: a, f.
    expect(facets.signals).toEqual({ gold: 1, sponsored: 2, email: 0, confirmed: 0, fresh: 2 });
  });

  it("still applies the free text to every facet", () => {
    const facets = facetCounts(all, filterWith({ q: "promptlab" }));
    expect(facets.stages.new).toBe(1);
    expect(facets.countries).toEqual({ US: 1, GB: 0, IN: 0 });
  });

  it("answers zeros for an empty catalog", () => {
    const facets = facetCounts([], emptyFindFilter);
    expect(Object.values(facets.stages).every((n) => n === 0)).toBe(true);
    expect(facets.countries).toEqual({});
    expect(facets.runs).toEqual({});
  });
});

describe("queryCatalog", () => {
  it("filters, sorts and counts the total before paging", () => {
    const page = queryCatalog(all, emptyFindFilter, "median", 0, 2);
    expect(page.total).toBe(5);
    expect(ids(page.items)).toEqual(["c", "f"]);
    expect(page.items[0]?.fit.score).toBe(45);
    expect(page.facets.stages.rejected).toBe(1);
  });

  it("pages with an offset", () => {
    expect(ids(queryCatalog(all, emptyFindFilter, "median", 2, 2).items)).toEqual(["a", "e"]);
    expect(ids(queryCatalog(all, emptyFindFilter, "median", 4, 2).items)).toEqual(["b"]);
    expect(queryCatalog(all, emptyFindFilter, "median", 10, 2).items).toEqual([]);
  });

  it("counts the facets unless asked not to", () => {
    expect(queryCatalog(all, emptyFindFilter, "fit", 0, 2, { facets: true }).facets).toEqual(
      facetCounts(all, emptyFindFilter),
    );
    const light = queryCatalog(all, emptyFindFilter, "fit", 0, 2, { facets: false });
    expect(light.facets).toEqual(emptyFacets);
    expect(light.total).toBe(5);
    expect(ids(light.items)).toEqual(ids(queryCatalog(all, emptyFindFilter, "fit", 0, 2).items));
  });

  it("returns an empty page for an empty catalog", () => {
    expect(queryCatalog([], emptyFindFilter, "fit", 0, 10)).toMatchObject({ total: 0, items: [] });
  });
});
