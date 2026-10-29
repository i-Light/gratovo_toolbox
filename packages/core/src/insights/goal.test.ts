import { describe, expect, it } from "vitest";

import { goalLines, goalReport, levers, ownRates } from "./goal";
import type { MailboxFacts } from "./inputs";
import { reportWindow } from "./stats";
import { ch, DAY, emptyArchive, ev, incoming, inputs, NOW, out } from "./test-inputs";

const win = reportWindow("30d", NOW);

/** `n` creators first emailed 20 days ago; the first `replied` answered; the first `signed` signed. */
function cohort(n: number, replied: number, signed: number) {
  const messages = [];
  const events = [];
  const channels = [];
  for (let i = 0; i < n; i += 1) {
    const id = `c${String(i)}`;
    channels.push(ch(id, { stage: i < signed ? "signed" : i < replied ? "replied" : "emailed" }));
    messages.push(out(id, NOW - 20 * DAY));
    if (i < replied) messages.push(incoming(id, NOW - 18 * DAY, { reading: "interested" }));
    if (i < signed) events.push(ev(id, "signed", NOW - 10 * DAY));
  }
  return { messages, events, channels };
}

const box = (address: string, over: Partial<MailboxFacts> = {}): MailboxFacts => ({
  address,
  dailyCap: 30,
  warmupStartedAt: null,
  warmupDays: null,
  heldAt: null,
  paused: false,
  ...over,
});

describe("ownRates", () => {
  it("uses guesses and the course floor when nothing is counted", () => {
    const r = ownRates(inputs());
    expect(r.replied).toEqual({ value: 0.15, source: "guess", count: null });
    expect(r.firstEmails).toEqual({ value: 0.04, source: "course", count: null });
    expect(r.triage).toEqual({ value: 0.45, source: "guess", count: null });
    expect(r.find).toEqual({ value: 0.13, source: "guess", count: null });
  });

  it("uses your own rate once the count reaches minOther", () => {
    const r = ownRates(inputs(cohort(40, 10, 5)));
    expect(r.firstEmails.source).toBe("yours");
    expect(r.firstEmails.value).toBeCloseTo(0.25);
    expect(r.firstEmails.count).toEqual({ n: 10, d: 40 });
    expect(r.replied.source).toBe("guess"); // only 10 replied
  });

  it("falls back below minOther", () => {
    expect(ownRates(inputs(cohort(19, 10, 5))).firstEmails.source).toBe("course");
  });

  it("finds the share that passed the rules from the catalog and archive", () => {
    const channels = Array.from({ length: 30 }, (_, i) => ch(`k${String(i)}`));
    const r = ownRates(inputs({ channels, archive: { ...emptyArchive, total: 70, byRules: 60 } }));
    expect(r.find.source).toBe("yours");
    expect(r.find.value).toBeCloseTo(0.4);
  });

  it("lets an override win", () => {
    const r = ownRates(
      inputs({ ...cohort(40, 10, 5), goal: { signsPerMonth: 4, overrides: { firstEmails: 0.1 } } }),
    );
    expect(r.firstEmails).toEqual({ value: 0.1, source: "override", count: null });
  });
});

describe("goalLines and goalReport", () => {
  const rates = ownRates(inputs());
  const settings = { signsPerMonth: 4, overrides: {} };
  const actual = {
    signed: 0,
    replied: 0,
    firstPerDay: 0,
    triagePerDay: 0,
    findPerDay: 0,
    known: true,
  };

  it("works the chain back from the target", () => {
    const lines = goalLines(settings, rates, actual);
    expect(lines.map((l) => l.step)).toEqual([
      "signed",
      "replied",
      "firstEmails",
      "triage",
      "find",
    ]);
    expect(lines[0]).toMatchObject({ month: 4, rate: null, perDay: null });
    expect(lines[1]?.month).toBeCloseTo(4 / 0.15);
    expect(lines[2]?.month).toBeCloseTo(4 / 0.15 / 0.04);
    expect(lines[2]?.perDay).toBeCloseTo(4 / 0.15 / 0.04 / 22);
    expect(lines[4]?.month).toBeCloseTo(4 / 0.15 / 0.04 / 0.45 / 0.13);
  });

  it("marks verdicts: good, watch, act, with how short", () => {
    const need = goalLines(settings, rates, actual)[2]?.perDay ?? 0;
    const at = (firstPerDay: number) =>
      goalLines(settings, rates, { ...actual, firstPerDay, signed: 4, replied: 100 })[2];
    expect(at(need)?.verdict).toBe("good");
    expect(at(need * 0.7)?.verdict).toBe("watch");
    expect(at(need * 0.7)?.shortBy).toBeCloseTo(need * 0.3);
    expect(at(need * 0.4)?.verdict).toBe("act");
  });

  it("is early everywhere with no data", () => {
    const lines = goalLines(settings, rates, { ...actual, known: false });
    expect(lines.every((l) => l.verdict === "early")).toBe(true);
  });

  it("names the step that falls shortest", () => {
    const messages = Array.from({ length: 10 }, (_, i) => out(`x${String(i)}`, NOW - 5 * DAY));
    const r = goalReport(inputs({ messages }), win);
    expect(r.shortStep).not.toBeNull();
    const first = r.lines.find((l) => l.step === "firstEmails");
    expect(first?.verdict).not.toBe("good");
    expect(first?.actualPerDay).toBeGreaterThan(0);
  });

  it("has no short step when every line is met", () => {
    const messages = Array.from({ length: 2000 }, (_, i) => out(`x${String(i)}`, NOW - 5 * DAY));
    const events = [
      ...Array.from({ length: 2000 }, (_, i) => ev(`y${String(i)}`, "shortlisted", NOW - DAY)),
      ...Array.from({ length: 10 }, (_, i) => ev(`s${String(i)}`, "signed", NOW - 2 * DAY)),
    ];
    const channels = Array.from({ length: 5000 }, (_, i) =>
      ch(`z${String(i)}`, { foundAt: NOW - DAY }),
    );
    const replies = Array.from({ length: 200 }, (_, i) => incoming(`r${String(i)}`, NOW - 2 * DAY));
    const r = goalReport(inputs({ messages: [...messages, ...replies], events, channels }), win);
    expect(r.shortStep).toBeNull();
  });

  it("orders levers by the biggest cut and shows before and after", () => {
    const l = levers(settings, rates);
    expect(l).toHaveLength(2);
    const cut = (x: (typeof l)[number] | undefined) => (x ? x.emailsFrom - x.emailsTo : 0);
    expect(cut(l[0])).toBeGreaterThanOrEqual(cut(l[1]));
    const reply = l.find((x) => x.kind === "replyRate");
    expect(reply?.to).toBeCloseTo(0.05);
    expect(reply?.emailsTo).toBeLessThan(reply?.emailsFrom ?? 0);
  });

  it("works out room: follow-ups per first email, and capacity", () => {
    const r = goalReport(
      inputs({ mailboxes: [box("a@x"), box("b@x", { heldAt: 20 }), box("c@x", { paused: true })] }),
      win,
    );
    expect(r.room.capacity).toBe(50);
    const perDay = r.lines.find((l) => l.step === "firstEmails")?.perDay ?? 0;
    expect(r.room.needed).toBeCloseTo(perDay * 4); // 3 follow-ups when not known
  });

  it("builds from empty inputs", () => {
    const r = goalReport(inputs(), win);
    expect(r.shortStep).toBeNull();
    expect(r.room.capacity).toBe(0);
  });
});
