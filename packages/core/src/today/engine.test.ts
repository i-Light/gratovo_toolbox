import { describe, expect, it } from "vitest";

import { bareBrand, bareDeal } from "../data";
import type {
  Brand,
  Creator,
  CreatorStage,
  Deal,
  OutreachDraft,
  Sequence,
  ThreadSummary,
} from "../data";
import { DEAL_FLOW } from "../deal-flow";

import {
  overBudget,
  phaseCounts,
  plannedMinutes,
  pruneDay,
  snoozeOptions,
  todayItems,
  tomorrowItems,
} from "./engine";
import { defaultDay, dayNoteMax, doneMax, snoozedMax } from "./types";
import type { DayState, TodayInput, TodayItem } from "./types";

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 9, 10).getTime(); // Monday 10:00 local
const step = (key: string): number => DEAL_FLOW.findIndex((s) => s.key === key);

const creator = (id: string, stage: CreatorStage, over: Partial<Creator> = {}): Creator => ({
  id,
  name: id,
  handle: `@${id}`,
  stage,
  email: `${id}@ai.test`,
  emailConfirmed: true,
  contactName: null,
  contactSource: null,
  contactConfidence: null,
  rejectReason: null,
  rejectedAt: null,
  neverReason: null,
  archiveDueAt: null,
  kit: null,
  ...over,
});

const draft = (id: string, who: string, over: Partial<OutreachDraft> = {}): OutreachDraft => ({
  id,
  creator: who,
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
  createdAt: 100,
  updatedAt: 100,
  ...over,
});

const thread = (who: string, at: number, over: Partial<ThreadSummary> = {}): ThreadSummary => ({
  creator: who,
  count: 2,
  lastOutAt: at - 1000,
  lastIn: { id: `m-${who}`, at, reading: null, preview: "", bounce: false },
  answered: false,
  ...over,
});

const deal = (
  id: string,
  over: Partial<Omit<Deal, "invoice">> & { invoice?: Partial<Deal["invoice"]> } = {},
): Deal => {
  const base = bareDeal({ id, brand: "b", creator: "c", step: 0, price: null });
  const { invoice, ...rest } = over;
  return { ...base, ...rest, invoice: { ...base.invoice, ...invoice } };
};

const brand = (id: string, over: Partial<Brand> = {}): Brand => ({
  ...bareBrand({ id, name: id, sells: "AI tools", status: "found" }),
  ...over,
});

const seq = (who: string, dueAt: number, over: Partial<Sequence> = {}): Sequence => ({
  creator: who,
  mailbox: "a@ai.test",
  startedAt: NOW - 3 * DAY,
  steps: [{ n: 1, dueAt, state: "planned", sentAt: null }],
  stopped: null,
  parkUntil: null,
  ...over,
});

const input = (over: Partial<TodayInput> = {}): TodayInput => ({
  now: NOW,
  seesMoney: true,
  parts: { deals: true },
  creators: [],
  brands: [],
  deals: [],
  reach: { drafts: [], threads: [], sequences: [] },
  newFinds: 0,
  snoozed: {},
  ...over,
});

const keys = (i: TodayInput): string[] => todayItems(i).map((x) => x.key);
const find = (i: TodayInput, key: string): TodayItem | undefined =>
  todayItems(i).find((x) => x.key === key);

describe("money", () => {
  it("lists a deal at invoice with no invoice sent, due at go-live", () => {
    const d = deal("d1", { step: step("invoice"), goLiveAt: NOW - DAY });
    const it = find(input({ deals: [d] }), "invoice:d1");
    expect(it).toMatchObject({ bucket: "money", kind: "invoice", minutes: 3, due: NOW - DAY });
    expect(it?.ref).toEqual({ kind: "deal", id: "d1" });
  });

  it("lists collect when sent, unpaid and due within 3 days", () => {
    const due = NOW + 3 * DAY;
    const d = deal("d1", { step: step("report"), invoice: { sentAt: NOW - DAY, dueAt: due } });
    expect(find(input({ deals: [d] }), "collect:d1")).toMatchObject({ due, minutes: 3 });
    const later = deal("d2", { step: step("report"), invoice: { sentAt: NOW, dueAt: due + 1 } });
    expect(keys(input({ deals: [later] }))).not.toContain("collect:d2");
    const paid = deal("d3", { invoice: { sentAt: NOW, dueAt: due, paidAt: NOW } });
    expect(keys(input({ deals: [paid] }))).not.toContain("collect:d3");
  });

  it("lists payout when paid and the creator is not, due paid + 2 days", () => {
    const d = deal("d1", { step: step("pay"), invoice: { sentAt: 1, dueAt: 2, paidAt: NOW } });
    expect(find(input({ deals: [d] }), "payout:d1")).toMatchObject({
      due: NOW + 2 * DAY,
      minutes: 2,
    });
    const done = deal("d2", { step: step("pay"), paidCreatorAt: NOW, invoice: { paidAt: NOW } });
    expect(keys(input({ deals: [done] }))).not.toContain("payout:d2");
    const early = deal("d3", { step: step("golive"), invoice: { paidAt: NOW } });
    expect(keys(input({ deals: [early] }))).not.toContain("payout:d3");
  });

  it("is hidden without seesMoney or without parts.deals", () => {
    const d = deal("d1", { step: step("invoice") });
    expect(keys(input({ deals: [d], seesMoney: false }))).toEqual([]);
    expect(keys(input({ deals: [d], parts: { deals: false } }))).toEqual([]);
  });
});

describe("deals", () => {
  it("lists deals due within 2 days, with minutes by step", () => {
    const at = (s: string): Deal => deal(`x-${s}`, { step: step(s), dueAt: NOW + 2 * DAY });
    const i = input({ deals: [at("brief"), at("report"), at("next")], seesMoney: false });
    expect(find(i, "deal:x-brief")?.minutes).toBe(4);
    expect(find(i, "deal:x-report")?.minutes).toBe(8);
    expect(find(i, "nextdeal:x-next")).toMatchObject({
      kind: "nextdeal",
      minutes: 5,
      bucket: "deals",
    });
  });

  it("skips invoice and pay steps, no due date, and far dates", () => {
    const i = input({
      seesMoney: false,
      deals: [
        deal("a", { step: step("invoice"), dueAt: NOW }),
        deal("b", { step: step("pay"), dueAt: NOW }),
        deal("c", { step: step("brief"), dueAt: null }),
        deal("d", { step: step("brief"), dueAt: NOW + 2 * DAY + 1 }),
      ],
    });
    expect(keys(i)).toEqual([]);
  });

  it("needs parts.deals", () => {
    const d = deal("a", { step: step("brief"), dueAt: NOW });
    expect(keys(input({ deals: [d], parts: { deals: false } }))).toEqual([]);
  });
});

describe("replies and sends", () => {
  const creators = [creator("c1", "replied"), creator("c2", "emailed")];

  it("lists a reply that waits, with its answer draft, aged from lastIn", () => {
    const i = input({
      creators,
      reach: {
        threads: [thread("c1", NOW - 5000)],
        drafts: [draft("r1", "c1", { kind: "reply", state: "ready" })],
        sequences: [],
      },
    });
    expect(find(i, "reply:c1")).toMatchObject({
      bucket: "replies",
      draft: "r1",
      due: NOW - 5000,
      age: true,
      minutes: 3,
    });
  });

  it("lists a reply with no draft yet as draft null; leaves out answered ones", () => {
    const i = input({
      creators,
      reach: {
        threads: [thread("c1", NOW - 1), thread("c2", NOW - 2, { answered: true })],
        drafts: [],
        sequences: [],
      },
    });
    expect(find(i, "reply:c1")?.draft).toBeNull();
    expect(keys(i)).not.toContain("reply:c2");
  });

  it("does not list the reply's own draft under sends", () => {
    const i = input({
      creators,
      reach: {
        threads: [thread("c1", NOW - 1)],
        drafts: [draft("r1", "c1", { kind: "reply" }), draft("f1", "c2")],
        sequences: [],
      },
    });
    expect(keys(i)).toEqual(["reply:c1", "send:f1"]);
  });

  it("lists ready and failed drafts only; quick when ready with no problem", () => {
    const i = input({
      creators,
      reach: {
        threads: [],
        drafts: [
          draft("a", "c2", { state: "ready" }),
          draft("b", "c2", { state: "failed" }),
          draft("c", "c2", { state: "approved" }),
          draft("d", "c2", { state: "sent" }),
        ],
        sequences: [],
      },
    });
    expect(keys(i)).toEqual(["send:a", "send:b"]);
    expect(find(i, "send:a")).toMatchObject({ quick: true, minutes: 1.5, draft: "a" });
    expect(find(i, "send:b")?.quick).toBe(false);
    expect(find(i, "send:a")?.ref).toEqual({ kind: "creator", id: "c2" });
  });
});

describe("followups", () => {
  it("lists follow-up drafts as quick items due now", () => {
    const i = input({
      creators: [creator("c1", "emailed")],
      reach: {
        threads: [],
        drafts: [draft("f1", "c1", { kind: "followUp", followUp: 1 })],
        sequences: [],
      },
    });
    expect(find(i, "followup:f1")).toMatchObject({
      bucket: "followups",
      due: NOW,
      minutes: 1,
      quick: true,
      draft: "f1",
    });
    expect(keys(i)).not.toContain("send:f1");
  });

  it("nudges a pitched brand 5 days after the pitch, with its owner", () => {
    const at = NOW - 5 * DAY;
    const b = brand("b1", {
      status: "pitched",
      pitched: { at, creators: [], mode: "cold" },
      owner: "m1",
    });
    expect(find(input({ brands: [b] }), "bnudge:b1")).toMatchObject({
      due: NOW,
      minutes: 2,
      quick: true,
      owner: "m1",
    });
    const fresh = brand("b2", {
      status: "pitched",
      pitched: { at: at + 1, creators: [], mode: "cold" },
    });
    expect(keys(input({ brands: [fresh] }))).toEqual([]);
    expect(keys(input({ brands: [b], parts: { deals: false } }))).toEqual([]);
  });
});

describe("close, contacts, finds", () => {
  it("lists audience checks, qualify and pitch", () => {
    const i = input({
      creators: [creator("k", "kit")],
      brands: [brand("f", { status: "found", owner: "m2" }), brand("q", { status: "qualified" })],
    });
    expect(find(i, "audience:k")).toMatchObject({ bucket: "close", minutes: 3 });
    expect(find(i, "qualify:f")).toMatchObject({ minutes: 4, owner: "m2" });
    expect(find(i, "pitch:q")).toMatchObject({ minutes: 5 });
    expect(
      keys(input({ brands: [brand("f", { status: "found" })], parts: { deals: false } })),
    ).toEqual([]);
  });

  it("lists shortlisted creators, quick when there is an address", () => {
    const i = input({
      creators: [creator("a", "shortlisted"), creator("b", "shortlisted", { email: null })],
    });
    expect(find(i, "contact:a")).toMatchObject({ bucket: "contacts", minutes: 2, quick: true });
    expect(find(i, "contact:b")?.quick).toBe(false);
  });

  it("makes one finds item with minutes max(2, round(n / 2))", () => {
    expect(find(input({ newFinds: 1 }), "finds")).toMatchObject({
      ref: null,
      minutes: 2,
      bucket: "finds",
    });
    expect(find(input({ newFinds: 11 }), "finds")?.minutes).toBe(6);
    expect(keys(input({ newFinds: 0 }))).toEqual([]);
  });
});

describe("snoozed and order", () => {
  it("leaves out snoozed keys until they come back", () => {
    const i = input({ creators: [creator("a", "kit"), creator("b", "kit")] });
    expect(keys({ ...i, snoozed: { "audience:a": NOW + 1 } })).toEqual(["audience:b"]);
    expect(keys({ ...i, snoozed: { "audience:a": NOW } })).toEqual(["audience:a", "audience:b"]);
  });

  it("sorts by bucket, then due (none last), then key", () => {
    const i = input({
      newFinds: 4,
      creators: [creator("z", "kit"), creator("a", "kit"), creator("s", "shortlisted")],
      deals: [
        deal("d2", { step: step("brief"), dueAt: NOW + DAY }),
        deal("d1", { step: step("brief"), dueAt: NOW - DAY }),
        deal("d3", { step: step("brief"), dueAt: NOW + DAY }),
      ],
      seesMoney: false,
    });
    expect(keys(i)).toEqual([
      "deal:d1",
      "deal:d2",
      "deal:d3",
      "audience:a",
      "audience:z",
      "contact:s",
      "finds",
    ]);
    const withDue = input({
      brands: [brand("n", { status: "qualified" })],
      deals: [deal("d", { step: step("brief"), dueAt: NOW })],
      seesMoney: false,
    });
    expect(keys(withDue)).toEqual(["deal:d", "pitch:n"]);
  });
});

describe("counts and budget", () => {
  const item = (bucket: TodayItem["bucket"], key: string, minutes = 1): TodayItem => ({
    key,
    bucket,
    kind: "finds",
    ref: null,
    draft: null,
    due: null,
    age: false,
    minutes,
    quick: false,
    owner: null,
  });

  it("counts by phase", () => {
    const items = [
      item("finds", "a"),
      item("contacts", "b"),
      item("replies", "c"),
      item("sends", "d"),
      item("followups", "e"),
      item("close", "f"),
      item("money", "g"),
      item("deals", "h"),
    ];
    expect(phaseCounts(items, 7)).toEqual({ find: 8, reach: 3, close: 1, deliver: 2 });
    expect(phaseCounts([], 7)).toEqual({ find: 0, reach: 0, close: 0, deliver: 0 });
  });

  it("sums the minutes, rounded", () => {
    expect(
      plannedMinutes([item("sends", "a", 1.5), item("sends", "b", 1.5), item("sends", "c", 1)]),
    ).toBe(4);
    expect(plannedMinutes([])).toBe(0);
  });

  it("defers from the end while over budget, counting done minutes", () => {
    const items = [item("sends", "a", 10), item("sends", "b", 10), item("sends", "c", 10)];
    expect(overBudget(items, 30, 0)).toEqual([]);
    expect(overBudget(items, 25, 0)).toEqual(["c"]);
    expect(overBudget(items, 20, 5)).toEqual(["c", "b"]);
  });

  it("never defers the first item", () => {
    const items = [item("sends", "a", 10), item("sends", "b", 10)];
    expect(overBudget(items, 1, 0)).toEqual(["b"]);
    expect(overBudget([], 1, 0)).toEqual([]);
  });
});

describe("snoozeOptions", () => {
  const at = (y: number, m: number, d: number, h: number): number => new Date(y, m, d, h).getTime();
  const local = (t: number): [number, number, number, number] => {
    const d = new Date(t);
    return [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()];
  };

  it("offers 15:00 today before 14:00 only", () => {
    const early = snoozeOptions(at(2026, 10, 9, 13), 9);
    expect(early.later === null ? null : local(early.later)).toEqual([2026, 10, 9, 15]);
    expect(snoozeOptions(at(2026, 10, 9, 14), 9).later).toBeNull();
    expect(snoozeOptions(at(2026, 10, 9, 18), 9).later).toBeNull();
  });

  it("puts tomorrow and two weeks at the morning hour", () => {
    const o = snoozeOptions(at(2026, 10, 9, 10), 8);
    expect(local(o.tomorrow)).toEqual([2026, 10, 10, 8]);
    expect(local(o.twoWeeks)).toEqual([2026, 10, 23, 8]);
  });

  it("puts Monday on the next Monday, never today", () => {
    expect(local(snoozeOptions(at(2026, 10, 9, 10), 9).monday)).toEqual([2026, 10, 16, 9]); // Mon
    expect(local(snoozeOptions(at(2026, 10, 10, 10), 9).monday)).toEqual([2026, 10, 16, 9]); // Tue
    expect(local(snoozeOptions(at(2026, 10, 14, 10), 9).monday)).toEqual([2026, 10, 16, 9]); // Sat
  });

  it("handles a Sunday: Monday is tomorrow", () => {
    const o = snoozeOptions(at(2026, 10, 15, 16), 7); // Sun
    expect(local(o.monday)).toEqual([2026, 10, 16, 7]);
    expect(o.monday).toBe(o.tomorrow);
    expect(o.later).toBeNull();
  });
});

describe("tomorrowItems", () => {
  const tomorrow = (h: number): number => new Date(2026, 10, 10, h).getTime();
  const day: DayState = {
    ...defaultDay,
    snoozed: {
      a: { until: tomorrow(9), title: "A" },
      b: { until: tomorrow(23), title: "B" },
      c: { until: new Date(2026, 10, 11, 0, 0).getTime(), title: "C" },
      d: { until: NOW + 1000, title: "D" },
    },
  };

  it("counts snoozes, follow-up steps and deal steps on tomorrow's date", () => {
    const i = input({
      reach: {
        drafts: [],
        threads: [],
        sequences: [
          seq("c1", tomorrow(9)),
          seq("c2", tomorrow(9), { stopped: "replied" }),
          seq("c3", tomorrow(9), { parkUntil: NOW + DAY * 9 }),
          seq("c4", tomorrow(9), {
            steps: [{ n: 1, dueAt: tomorrow(9), state: "sent", sentAt: NOW }],
          }),
          seq("c5", NOW),
        ],
      },
      deals: [deal("d1", { dueAt: tomorrow(12) }), deal("d2", { dueAt: NOW }), deal("d3")],
    });
    expect(tomorrowItems(i, day)).toEqual({ snoozed: 2, followUps: 1, dealSteps: 1 });
  });

  it("leaves out deal steps without parts.deals", () => {
    const i = input({ parts: { deals: false }, deals: [deal("d1", { dueAt: tomorrow(12) })] });
    expect(tomorrowItems(i, defaultDay).dealSteps).toBe(0);
  });
});

describe("pruneDay", () => {
  const entry = (key: string, at: number): DayState["done"][number] => ({
    key,
    title: key,
    bucket: "sends",
    at,
    minutes: 1,
  });
  const yesterday0 = new Date(2026, 10, 8).getTime();

  it("keeps done from yesterday's midnight, newest first", () => {
    const day: DayState = {
      ...defaultDay,
      done: [entry("old", yesterday0 - 1), entry("y", yesterday0), entry("t", NOW - 1)],
    };
    expect(pruneDay(day, NOW).done.map((e) => e.key)).toEqual(["t", "y"]);
  });

  it("caps done at doneMax, keeping the newest", () => {
    const done = Array.from({ length: doneMax + 5 }, (_, i) =>
      entry(`k${String(i)}`, yesterday0 + i),
    );
    const out = pruneDay({ ...defaultDay, done }, NOW).done;
    expect(out).toHaveLength(doneMax);
    expect(out[0]?.key).toBe(`k${String(doneMax + 4)}`);
  });

  it("drops past snoozes and keeps the soonest when over the cap", () => {
    const snoozed: Record<string, { until: number; title: string }> = {
      gone: { until: NOW, title: "" },
    };
    for (let i = 0; i < snoozedMax + 3; i++) {
      snoozed[`s${String(i)}`] = { until: NOW + 1000 + i, title: "" };
    }
    const out = pruneDay({ ...defaultDay, snoozed }, NOW).snoozed;
    expect(Object.keys(out)).toHaveLength(snoozedMax);
    expect(out.gone).toBeUndefined();
    expect(out.s0).toBeDefined();
    expect(out[`s${String(snoozedMax + 2)}`]).toBeUndefined();
  });

  it("clips the note and keeps the rest", () => {
    const day: DayState = {
      ...defaultDay,
      hours: 6,
      note: "x".repeat(dayNoteMax + 10),
      wrappedAt: 5,
    };
    const out = pruneDay(day, NOW);
    expect(out.note).toHaveLength(dayNoteMax);
    expect(out).toMatchObject({ hours: 6, wrappedAt: 5 });
  });
});
