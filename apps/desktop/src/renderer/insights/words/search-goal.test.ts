import { describe, expect, it } from "vitest";

import { strings } from "../../strings";
import {
  emptySearchReport,
  goalReport,
  keyword,
  mistake,
  searchReport,
} from "../test-reports-search";
import { chainHeadline, rateText, roomHeadline, roomVerdict, sourceText } from "./goal";
import {
  backlogHeadline,
  heroHeadline,
  heroMeaning,
  keywordHeadline,
  keywordMeaning,
  leavesLabel,
  mistakesHeadline,
  profileHeadline,
  reasonsHeadline,
  refindHeadline,
  restoreIds,
  ruleLabel,
  secondLooksHeadline,
  seriesChange,
  trustHeadline,
} from "./search";

const text = strings.insights.search;

describe("search words", () => {
  it("chooses the hero headline of each view", () => {
    const r = searchReport();
    expect(heroHeadline("live", r)).toEqual({
      lead: "2,000 live channels.",
      accent: "340 wait for your review.",
    });
    expect(heroHeadline("waiting", r).accent).toBe("37 look like mistakes.");
    expect(heroHeadline("archive", r).lead).toBe("150,200 archived.");
    expect(heroHeadline("archive", r).accent).toBe("No person saw 94% of them.");
    expect(heroHeadline("everything", r).lead).toBe("Of 162,400 found, 1 in 81 is live.");
  });

  it("has words for empty views", () => {
    const e = emptySearchReport();
    expect(heroHeadline("live", e).accent).toBe(text.hero.live.accentNone);
    expect(heroHeadline("waiting", e)).toEqual({ lead: text.hero.waiting.leadNone, accent: null });
    expect(heroHeadline("archive", e).lead).toBe(text.hero.archive.leadNone);
    expect(heroHeadline("everything", e).lead).toBe(text.hero.everything.none);
  });

  it("says no channel is live rather than dividing by zero", () => {
    const r = searchReport({ counts: { live: 0, waiting: 5, archive: 5, everything: 10 } });
    expect(heroHeadline("everything", r).lead).toBe("Of 10 found, none is live.");
  });

  it("finds how few keywords bring most signings", () => {
    expect(keywordHeadline(searchReport().keywords)).toBe(
      "Two keywords bring almost every signing.",
    );
    expect(keywordHeadline([keyword("a", { signed: 5 }), keyword("b", { signed: 0 })])).toBe(
      "One keyword brings almost every signing.",
    );
    expect(keywordHeadline([keyword("a", { signed: 0 })])).toBe(text.keywords.headlineNone);
    expect(keywordHeadline([])).toBe(text.keywords.headlineNoKeywords);
    const spread = ["a", "b", "c", "d"].map((k) => keyword(k, { signed: 2 }));
    expect(keywordHeadline(spread)).toBe("Signings come from 4 keywords.");
  });

  it("names the best keywords and the one that gets no answers", () => {
    const sentence = keywordMeaning(searchReport().keywords);
    expect(sentence).toContain("local llm setup and ai agents tutorial found 6 of the 7 signings.");
    expect(sentence).toContain("ai news weekly found the most of all, 38,600");
  });

  it("words the review backlog", () => {
    expect(backlogHeadline(340)).toBe("340 channels wait for your review.");
    expect(backlogHeadline(0)).toBe(text.backlog.headlineNone);
  });

  it("counts the unreadable without the missing country", () => {
    expect(trustHeadline({ notRead: 120, retrying: 34, gaveUp: 18, noCountry: 410 })).toBe(
      "172 live channels have numbers we couldn't read.",
    );
    expect(trustHeadline({ notRead: 0, retrying: 0, gaveUp: 0, noCountry: 9 })).toBe(
      text.trust.none,
    );
  });

  it("words the mistakes and when they leave", () => {
    expect(mistakesHeadline(37)).toBe("37 of them look like mistakes.");
    const now = new Date(2026, 9, 28, 12).getTime();
    expect(leavesLabel(now + 86_400_000, now)).toBe("Tomorrow");
    expect(leavesLabel(now + 3 * 86_400_000, now)).toBe("In 3 days");
    expect(leavesLabel(now, now)).toBe("Today");
  });

  it("chooses the finding about why channels were rejected", () => {
    const r = searchReport();
    expect(reasonsHeadline(r)).toBe("Half were rejected for not being about AI.");
    expect(heroMeaning("waiting", r)).toBe(text.hero.meaning.waitingTooBroad);
    const mostly = searchReport({
      waiting: {
        ...r.waiting,
        reasons: [
          { reason: "views", count: 90 },
          { reason: "ai", count: 10 },
        ],
      },
    });
    expect(reasonsHeadline(mostly)).toBe("Most were rejected for too few views.");
    expect(reasonsHeadline(emptySearchReport())).toBe(text.reasonsPanel.none);
  });

  it("judges the second looks", () => {
    expect(secondLooksHeadline(searchReport().waiting.secondLooks)).toBe(
      "Second looks rarely pay off, except on posting.",
    );
    expect(secondLooksHeadline([])).toBe(text.second.headlineNone);
    expect(
      secondLooksHeadline([{ reason: "ai", back: 3, emailed: 1, replied: 0, signed: 0 }]),
    ).toBe(text.second.headlineNoPay);
  });

  it("restores at most 50 ids", () => {
    const many = Array.from({ length: 80 }, (_, i) => mistake(i));
    expect(restoreIds(many)).toHaveLength(50);
    expect(restoreIds(many.slice(0, 3))).toEqual(many.slice(0, 3).map((m) => m.id));
  });

  it("shows the app's tags through a map and a readable fallback", () => {
    expect(ruleLabel("inactive")).toBe(text.ruleLabels.inactive);
    expect(ruleLabel("haramStuff")).toBe(text.ruleLabels.haramStuff);
    expect(ruleLabel("tooBigAudience")).toBe("Too big audience");
    expect(ruleLabel("some_new-label")).toBe("Some new label");
    expect(ruleLabel("")).toBe(text.ruleUnknown);
  });

  it("finds worn-out searches", () => {
    expect(refindHeadline(searchReport().keywords)).toBe(text.refind.headlineFine);
    const worn = [
      keyword("a", { lastRun: { at: 1, fresh: 5, live: 10, archived: 85 } }),
      keyword("b", { lastRun: { at: 1, fresh: 0, live: 0, archived: 100 } }),
    ];
    expect(refindHeadline(worn)).toBe("2 keywords have run out of new channels.");
  });

  it("compares the archive with live", () => {
    const r = searchReport();
    expect(profileHeadline(r.archive.profiles)).toBe(text.profile.headlineMuchSmaller);
    expect(profileHeadline([])).toBe(text.profile.headlineUnknown);
  });

  it("measures change over the weeks that are known", () => {
    const w = [
      { at: 1, live: null, waiting: null, archive: null },
      { at: 2, live: 10, waiting: null, archive: 100 },
      { at: 3, live: 25, waiting: null, archive: 160 },
    ];
    expect(seriesChange(w, "live")).toBe(15);
    expect(seriesChange(w, "waiting")).toBeNull();
  });
});

describe("goal words", () => {
  it("names the step falling short", () => {
    expect(chainHeadline(goalReport())).toBe("First emails: 10 a day short.");
    expect(chainHeadline(goalReport({ shortStep: null }))).toBe(
      strings.insights.goal.chain.headlineNone,
    );
  });

  it("says when nothing is counted yet", () => {
    const early = goalReport();
    expect(
      chainHeadline({
        ...early,
        lines: early.lines.map((l) => ({ ...l, verdict: "early" as const })),
        shortStep: null,
      }),
    ).toBe(strings.insights.goal.chain.headlineEarly);
  });

  it("words the source of a rate", () => {
    expect(sourceText({ value: 0.049, source: "yours", count: { n: 61, d: 1240 } })).toBe(
      "yours, 61 of 1,240",
    );
    expect(sourceText({ value: 0.4, source: "override", count: null })).toBe("set by you");
    expect(rateText(0.049)).toBe("4.9%");
    expect(rateText(0.17)).toBe("17%");
  });

  it("words the mailbox room", () => {
    expect(roomHeadline({ needed: 47, capacity: 75 })).toBe(
      "Your mailboxes have room for 28 more a day.",
    );
    expect(roomHeadline({ needed: 80, capacity: 75 })).toBe(
      "You need 5 more emails a day than your mailboxes allow.",
    );
    expect(roomHeadline({ needed: 0, capacity: 0 })).toBe(strings.insights.goal.room.headlineNone);
    expect(roomVerdict({ needed: 80, capacity: 75 })).toBe("act");
    expect(roomVerdict({ needed: 70, capacity: 75 })).toBe("watch");
    expect(roomVerdict({ needed: 47, capacity: 75 })).toBe("good");
  });
});
