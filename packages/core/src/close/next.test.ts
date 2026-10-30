import { describe, expect, it } from "vitest";
import { bareBrand, bareDeal, defaultAgencyFacts as facts } from "../data";
import type { Brand, CreatorStage, Deal } from "../data";
import { emptyReach } from "../data/reach-types";
import type { OutreachDraft, ReachData, Sequence, ThreadSummary } from "../data/reach-types";
import { DEAL_FLOW } from "../deal-flow";
import type { MatchCreator, NextWorld } from "./engine-types";
import { nextFor } from "./next";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

type WorldCreator = NextWorld["creators"][number];

function wc(id: string, stage: CreatorStage, over: Partial<WorldCreator> = {}): WorldCreator {
  return {
    id,
    stage,
    email: null,
    emailConfirmed: false,
    rejectedAt: null,
    archiveDueAt: null,
    lastUpdateAt: null,
    kitAt: null,
    ...over,
  };
}

function mc(id: string): MatchCreator {
  return {
    id,
    name: id,
    views: 100_000,
    rate: null,
    relationship: null,
    fit: 50,
    sponsors: [],
    countries: [],
    locks: [],
    dreamBrands: [],
  };
}

function draft(id: string, creator: string, over: Partial<OutreachDraft> = {}): OutreachDraft {
  return {
    id,
    creator,
    kind: "first",
    followUp: null,
    state: "ready",
    subject: "",
    body: "",
    mailbox: null,
    sendAt: null,
    proposal: null,
    gatesOk: [],
    edited: false,
    checked: true,
    rewriting: null,
    replyTo: null,
    goal: null,
    problem: null,
    createdAt: NOW - DAY,
    updatedAt: NOW - DAY,
    ...over,
  };
}

function seq(creator: string, over: Partial<Sequence> = {}): Sequence {
  return {
    creator,
    mailbox: "a@x.io",
    startedAt: NOW - 10 * DAY,
    steps: [],
    stopped: null,
    parkUntil: null,
    ...over,
  };
}

function thread(creator: string, over: Partial<ThreadSummary> = {}): ThreadSummary {
  return { creator, count: 2, lastOutAt: null, lastIn: null, answered: false, ...over };
}

function lastIn(at: number): NonNullable<ThreadSummary["lastIn"]> {
  return { id: "m", at, reading: null, preview: "", bounce: false };
}

interface Setup {
  creators?: WorldCreator[];
  brands?: Brand[];
  deals?: Deal[];
  reach?: Partial<ReachData>;
  matches?: Record<string, MatchCreator>;
}

function world(s: Setup = {}): NextWorld {
  const matches = s.matches ?? {};
  return {
    brands: s.brands ?? [],
    deals: s.deals ?? [],
    now: NOW,
    facts,
    creators: s.creators ?? [],
    reach: { ...emptyReach, ...s.reach },
    matchCreator: (id) => matches[id] ?? null,
  };
}

function creatorNext(c: WorldCreator, s: Setup = {}) {
  return nextFor({ kind: "creator", id: c.id }, world({ ...s, creators: [c] }));
}

describe("nextFor: unknown ids", () => {
  it("answers null for a creator, brand or deal nobody knows", () => {
    const w = world();
    expect(nextFor({ kind: "creator", id: "x" }, w)).toBeNull();
    expect(nextFor({ kind: "brand", id: "x" }, w)).toBeNull();
    expect(nextFor({ kind: "deal", id: "x" }, w)).toBeNull();
  });
});

describe("nextFor: creators", () => {
  it("puts an open draft first, the newest of several, whatever the stage", () => {
    const c = wc("nova-ai", "signed");
    const drafts = [
      draft("old", "nova-ai", { createdAt: NOW - 3 * DAY }),
      draft("sent", "nova-ai", { state: "sent", createdAt: NOW }),
      draft("other", "someone", { createdAt: NOW }),
      draft("new", "nova-ai", { kind: "followUp", followUp: 2, createdAt: NOW - DAY }),
    ];
    expect(creatorNext(c, { reach: { drafts } })).toEqual({
      waiting: false,
      kind: "draft",
      draftId: "new",
      draft: "followUp",
      n: 2,
      at: NOW - DAY,
    });
    expect(
      creatorNext(c, {
        reach: {
          drafts: [draft("a", "nova-ai"), draft("b", "nova-ai", { createdAt: NOW - 9 * DAY })],
        },
      }),
    ).toMatchObject({ draftId: "a" });
  });

  it("sends new, shortlisted and contact creators to review, email check and first email", () => {
    expect(creatorNext(wc("a", "new"))).toEqual({ waiting: false, kind: "review" });
    expect(creatorNext(wc("a", "shortlisted", { email: "a@x.io" }))).toEqual({
      waiting: false,
      kind: "confirmEmail",
      hasEmail: true,
    });
    expect(creatorNext(wc("a", "shortlisted"))).toMatchObject({ hasEmail: false });
    expect(creatorNext(wc("a", "contact"))).toEqual({ waiting: false, kind: "firstEmail" });
  });

  describe("emailed", () => {
    const step = (
      n: number,
      state: Sequence["steps"][number]["state"],
      sentAt: number | null = null,
    ) => ({
      n,
      dueAt: NOW + n * DAY,
      state,
      sentAt,
    });
    const c = wc("a", "emailed");

    it("names the next unsent follow-up", () => {
      const s = seq("a", {
        steps: [step(1, "sent", NOW - 5 * DAY), step(2, "drafted"), step(3, "planned")],
      });
      expect(creatorNext(c, { reach: { sequences: [s] } })).toEqual({
        waiting: true,
        kind: "followUpDue",
        n: 2,
        at: NOW + 2 * DAY,
      });
      const planned = seq("a", { steps: [step(1, "skipped"), step(2, "planned")] });
      expect(creatorNext(c, { reach: { sequences: [planned] } })).toMatchObject({ n: 2 });
    });

    it("says the sequence is done when every step went and it is not stopped", () => {
      const s = seq("a", { steps: [step(1, "sent", NOW - 9 * DAY), step(2, "skipped")] });
      expect(creatorNext(c, { reach: { sequences: [s] } })).toEqual({
        waiting: true,
        kind: "sequenceDone",
      });
    });

    it("waits for a reply since the first sent step, else the start, else unknown", () => {
      const stopped = seq("a", { stopped: "you", steps: [step(1, "sent", NOW - 7 * DAY)] });
      expect(creatorNext(c, { reach: { sequences: [stopped] } })).toEqual({
        waiting: true,
        kind: "awaitReply",
        since: NOW - 7 * DAY,
      });
      const none = seq("a", { stopped: "you", steps: [step(1, "skipped")] });
      expect(creatorNext(c, { reach: { sequences: [none] } })).toMatchObject({
        since: NOW - 10 * DAY,
      });
      const unsentAt = seq("a", { stopped: "you", steps: [step(1, "sent")] });
      expect(creatorNext(c, { reach: { sequences: [unsentAt] } })).toMatchObject({
        since: NOW - 10 * DAY,
      });
      expect(creatorNext(c)).toEqual({ waiting: true, kind: "awaitReply", since: null });
    });
  });

  describe("replied", () => {
    const c = wc("a", "replied");

    it("asks for the kit when their message is the newest, or there is no thread", () => {
      const t = thread("a", { lastOutAt: NOW - 5 * DAY, lastIn: lastIn(NOW - DAY) });
      expect(creatorNext(c, { reach: { threads: [t] } })).toEqual({
        waiting: false,
        kind: "askKit",
        repliedAt: NOW - DAY,
      });
      const onlyIn = thread("a", { lastIn: lastIn(NOW - DAY) });
      expect(creatorNext(c, { reach: { threads: [onlyIn] } })).toMatchObject({ kind: "askKit" });
      expect(creatorNext(c)).toEqual({ waiting: false, kind: "askKit", repliedAt: null });
    });

    it("waits for the kit for two days after we asked, then nudges", () => {
      const fresh = thread("a", { lastOutAt: NOW - DAY, lastIn: lastIn(NOW - 2 * DAY) });
      expect(creatorNext(c, { reach: { threads: [fresh] } })).toEqual({
        waiting: true,
        kind: "awaitKit",
        askedAt: NOW - DAY,
        nudgeAt: NOW + DAY,
      });
      const stale = thread("a", { lastOutAt: NOW - 2 * DAY, lastIn: lastIn(NOW - 3 * DAY) });
      expect(creatorNext(c, { reach: { threads: [stale] } })).toEqual({
        waiting: false,
        kind: "nudgeKit",
        askedAt: NOW - 2 * DAY,
      });
      const noIn = thread("a", { lastOutAt: NOW - DAY });
      expect(creatorNext(c, { reach: { threads: [noIn] } })).toMatchObject({ kind: "awaitKit" });
    });
  });

  it("checks the audience of a creator at kit or audience", () => {
    expect(creatorNext(wc("a", "kit", { kitAt: NOW }))).toEqual({
      waiting: false,
      kind: "checkAudience",
      kitAt: NOW,
    });
    expect(creatorNext(wc("a", "audience"))).toMatchObject({ kitAt: null });
  });

  describe("signed", () => {
    it("sends a warmth update after 10 days without news", () => {
      const c = wc("a", "signed", { lastUpdateAt: NOW - 12.5 * DAY });
      expect(creatorNext(c)).toEqual({ waiting: false, kind: "warmth", days: 12 });
    });

    it("pitches the best brand, with its score and first reason", () => {
      const won = bareBrand({ id: "b1", name: "CodePilot", sells: "AI coding", status: "won" });
      const budget = { low: 1, high: 9000 };
      const c = wc("a", "signed", { lastUpdateAt: NOW - 9 * DAY });
      expect(creatorNext(c, { brands: [{ ...won, budget }], matches: { a: mc("a") } })).toEqual({
        waiting: false,
        kind: "pitchCreator",
        brandId: "b1",
        score: 42,
        why: { kind: "budgetFits", price: 4000, low: 1, high: 9000 },
      });
    });

    it("pitches with nulls when no brand fits, no why is found, or the creator can't be matched", () => {
      const c = wc("a", "signed");
      const empty = { waiting: false, kind: "pitchCreator", brandId: null, score: null, why: null };
      expect(creatorNext(c)).toEqual(empty);
      expect(creatorNext(c, { matches: { a: mc("a") } })).toEqual(empty);
      const plain = bareBrand({
        id: "b1",
        name: "CodePilot",
        sells: "AI coding",
        status: "qualified",
      });
      expect(creatorNext(c, { brands: [plain], matches: { a: mc("a") } })).toEqual({
        waiting: false,
        kind: "pitchCreator",
        brandId: "b1",
        score: 30,
        why: null,
      });
    });
  });

  it("reports parked, archived and never creators as waiting", () => {
    const s = seq("a", { parkUntil: NOW + 30 * DAY });
    expect(creatorNext(wc("a", "parked"), { reach: { sequences: [s] } })).toEqual({
      waiting: true,
      kind: "parked",
      until: NOW + 30 * DAY,
    });
    expect(creatorNext(wc("a", "parked"))).toMatchObject({ until: null });
    expect(creatorNext(wc("a", "rejected", { archiveDueAt: NOW + DAY }))).toEqual({
      waiting: true,
      kind: "archived",
      at: NOW + DAY,
    });
    expect(creatorNext(wc("a", "never"))).toEqual({ waiting: true, kind: "never" });
  });
});

describe("nextFor: brands", () => {
  function brandNext(over: Partial<Brand>, deals: Deal[] = []) {
    const b: Brand = {
      ...bareBrand({ id: "b1", name: "VoiceForge", sells: "AI voices", status: "found" }),
      ...over,
    };
    return nextFor({ kind: "brand", id: "b1" }, world({ brands: [b], deals }));
  }

  it("follows the lanes", () => {
    expect(brandNext({ seen: ["a", "b"] })).toEqual({ waiting: false, kind: "qualify", seen: 2 });
    expect(brandNext({ status: "qualified", budget: { low: 1, high: 2 } })).toEqual({
      waiting: false,
      kind: "pitchBrand",
      budget: { low: 1, high: 2 },
    });
    expect(brandNext({ status: "qualified" })).toMatchObject({ budget: null });
    expect(brandNext({ status: "negotiating" })).toEqual({ waiting: false, kind: "agreePrice" });
    expect(brandNext({ status: "lost" })).toEqual({ waiting: true, kind: "notFit" });
  });

  it("counts a won brand's deals", () => {
    const deals = [
      bareDeal({ id: "d1", brand: "b1", creator: "a", step: 3, price: null }),
      bareDeal({ id: "d2", brand: "b2", creator: "a", step: 3, price: null }),
    ];
    expect(brandNext({ status: "won" }, deals)).toEqual({
      waiting: false,
      kind: "nextCreator",
      deals: 1,
    });
  });

  it("waits five days after a pitch, then nudges", () => {
    const pitch = (at: number) => ({ at, creators: ["a"], mode: "cold" as const });
    expect(brandNext({ status: "pitched", pitched: pitch(NOW - 2 * DAY) })).toEqual({
      waiting: true,
      kind: "awaitBrand",
      pitchedAt: NOW - 2 * DAY,
      nudgeAt: NOW + 3 * DAY,
    });
    expect(brandNext({ status: "pitched", pitched: pitch(NOW - 5 * DAY) })).toEqual({
      waiting: false,
      kind: "brandNudge",
      pitchedAt: NOW - 5 * DAY,
    });
    expect(brandNext({ status: "pitched" })).toMatchObject({ kind: "awaitBrand", pitchedAt: NOW });
  });
});

describe("nextFor: deals", () => {
  function dealNext(over: Partial<Deal>) {
    const d: Deal = {
      ...bareDeal({ id: "d1", brand: "b1", creator: "a", step: 0, price: 4000 }),
      ...over,
    };
    return nextFor({ kind: "deal", id: "d1" }, world({ deals: [d] }));
  }
  const inv = (over: Partial<Deal["invoice"]>) => ({
    number: null,
    sentAt: null,
    dueAt: null,
    paidAt: null,
    ...over,
  });

  it("asks for the invoice at go-live", () => {
    expect(dealNext({ step: 6, goLiveAt: NOW })).toEqual({
      waiting: false,
      kind: "sendInvoice",
      goLiveAt: NOW,
    });
  });

  it("asks to pay the creator once the brand has paid", () => {
    const paid = inv({ sentAt: NOW - 30 * DAY, paidAt: NOW - DAY });
    expect(dealNext({ step: 8, payout: 2500, invoice: paid })).toEqual({
      waiting: false,
      kind: "payCreator",
      amount: 2500,
      paidAt: NOW - DAY,
    });
    expect(dealNext({ step: 8, invoice: paid })).toMatchObject({ amount: null });
  });

  it("does not ask to pay a creator already paid, or before step 6", () => {
    const paid = inv({ sentAt: NOW, paidAt: NOW });
    expect(dealNext({ step: 9, invoice: paid, paidCreatorAt: NOW })).toMatchObject({
      kind: "dealStep",
    });
    expect(dealNext({ step: 3, invoice: paid })).toMatchObject({ kind: "dealStep" });
  });

  it("waits for the brand at step 8 until the invoice is paid", () => {
    const sent = inv({ sentAt: NOW - DAY, dueAt: NOW + 29 * DAY });
    expect(dealNext({ step: 8, invoice: sent })).toEqual({
      waiting: true,
      kind: "awaitPayment",
      dueAt: NOW + 29 * DAY,
    });
  });

  it("names item 0 for a deal with no checks row", () => {
    // Unknown checks are not "all ticked": the deal still has its first item to do.
    expect(dealNext({ step: 3, checks: [] })).toMatchObject({ kind: "dealStep", item: 0 });
  });

  it("names the first unticked item of the step, counting missing checks as unticked", () => {
    const count = DEAL_FLOW[0]?.items.length ?? 0;
    expect(count).toBeGreaterThan(1);
    expect(dealNext({ step: 0, dueAt: NOW, checks: [true, false] })).toEqual({
      waiting: false,
      kind: "dealStep",
      step: 0,
      item: 1,
      dueAt: NOW,
    });
    expect(dealNext({ step: 0, checks: [] })).toMatchObject({ item: 0 });
    expect(dealNext({ step: 0, checks: [true] })).toMatchObject({ item: 1 });
    expect(dealNext({ step: 0, checks: Array.from({ length: count }, () => true) })).toMatchObject({
      item: null,
      dueAt: null,
    });
  });

  it("says move on for a step number with no checklist", () => {
    expect(dealNext({ step: 99 })).toMatchObject({ kind: "dealStep", step: 99, item: null });
  });
});
