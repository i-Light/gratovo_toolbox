import { beforeAll, describe, expect, it } from "vitest";

import { exampleSeed } from "./example";
import { exampleHistory } from "./example-history";
import type { ExampleHistory } from "./example-history";
import { creatorStages, rejectReasons } from "./types";

/** 20 October 2026, 10:30 local time (the same fixed day as example.test.ts). */
const now = new Date(2026, 9, 20, 10, 30).getTime();
const DAY = 86_400_000;
const HOUR = 3_600_000;
const idPattern = /^UC[A-Za-z0-9_-]{22}$/;

function required(history: ExampleHistory | null): ExampleHistory {
  if (history === null) throw new Error("The example history is missing");
  return history;
}

/** Within 15% of a target. */
function near(actual: number, expected: number, share = 0.15): void {
  expect(actual).toBeGreaterThanOrEqual(expected * (1 - share));
  expect(actual).toBeLessThanOrEqual(expected * (1 + share));
}

let started = 0;
let elapsed = 0;
let history: ExampleHistory;

beforeAll(() => {
  started = performance.now();
  history = required(exampleHistory(now, "normal"));
  elapsed = performance.now() - started;
});

/** Groups of Live by the creator's stage, as the Search tab counts them. */
function groups(h: ExampleHistory): Record<string, number> {
  const stages = new Map(h.gratovo.creators.map((c) => [c.channel_id, c.creator_stage]));
  const out: Record<string, number> = {
    notReviewed: 0,
    shortlisted: 0,
    outreach: 0,
    signed: 0,
    parked: 0,
    never: 0,
    waiting: 0,
  };
  for (const channel of h.pipeline.channels) {
    const stage = stages.get(channel.channel_id) ?? null;
    let key: string;
    if (stage === null || stage === "new") key = "notReviewed";
    else if (stage === "shortlisted" || stage === "contact") key = "shortlisted";
    else if (stage === "rejected") key = "waiting";
    else if (stage === "signed" || stage === "parked" || stage === "never") key = stage;
    else key = "outreach";
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function everReached(h: ExampleHistory): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const e of h.gratovo.events) {
    const set = out.get(e.stage) ?? new Set<string>();
    set.add(e.channel_id);
    out.set(e.stage, set);
  }
  return out;
}

describe("exampleHistory", () => {
  it("is null for the first scenario", () => {
    expect(exampleHistory(now, "first")).toBeNull();
  });

  it("generates in time", () => {
    console.log(`exampleHistory took ${elapsed.toFixed(0)} ms`);
    expect(elapsed).toBeLessThan(3000);
  });

  it("is deterministic", () => {
    const again = required(exampleHistory(now, "normal"));
    expect(JSON.stringify(again.gratovo)).toBe(JSON.stringify(history.gratovo));
    expect(JSON.stringify(again.pipeline.channels)).toBe(JSON.stringify(history.pipeline.channels));
    expect(again.pipeline.archive.tuples.length).toBe(history.pipeline.archive.tuples.length);
    const sum = (h: ExampleHistory): number => {
      let total = 0;
      for (const t of h.pipeline.archive.tuples) total = (total + t[2] + t[1] * 31 + t[4]) % 1e12;
      return total;
    };
    expect(sum(again)).toBe(sum(history));
    expect(again.pipeline.archive.tuples[1234]).toEqual(history.pipeline.archive.tuples[1234]);
  }, 20_000);

  it("gives the other scenarios their own data", () => {
    const later = required(exampleHistory(now, "later"));
    const shifted = required(exampleHistory(now - 7 * DAY, "normal"));
    expect(later.gratovo.creators.length).toBe(shifted.gratovo.creators.length);
    expect(later.gratovo.messages[100]).toEqual(shifted.gratovo.messages[100]);
  }, 20_000);
});

describe("the catalog", () => {
  it("has the plan's totals", () => {
    const tuples = history.pipeline.archive.tuples;
    const g = groups(history);
    const live = history.pipeline.channels.length - (g["waiting"] ?? 0);
    near(tuples.length, 150_200);
    near(g["waiting"] ?? 0, 10_200);
    near(live, 2_000);
    near(tuples.length + history.pipeline.channels.length, 162_400);
    const byRules = tuples.filter((t) => t[3] !== 3).length;
    near(byRules, 141_600);
    expect(history.pipeline.archive.labels[3]).toBe("rejected");
    expect(tuples.length - byRules).toBe(8_600);
  });

  it("splits Live and the waiting channels as planned", () => {
    const g = groups(history);
    near(g["notReviewed"] ?? 0, 340);
    near(g["shortlisted"] ?? 0, 290);
    near(g["outreach"] ?? 0, 1_180);
    expect(g["signed"]).toBe(16);
    expect(g["parked"]).toBe(70);
    expect(g["never"]).toBe(104);
    const unconfirmed = history.gratovo.creators.filter((c) => c.creator_stage === "shortlisted");
    expect(unconfirmed).toHaveLength(24);
    for (const c of unconfirmed) {
      const contact = (JSON.parse(c.contacts) as { confirmed: boolean }[])[0];
      expect(contact?.confirmed).toBe(false);
    }
    const dated = history.gratovo.creators.filter(
      (c) => c.creator_stage === "rejected" && c.archive_due_at !== null,
    );
    near(dated.length, 9_000);
    expect(
      history.gratovo.creators.filter(
        (c) => c.creator_stage === "rejected" && c.archive_due_at === null,
      ),
    ).toHaveLength(1_200);
  });

  it("has the funnel counts", () => {
    const reached = everReached(history);
    const size = (stage: string): number => reached.get(stage)?.size ?? 0;
    near(size("shortlisted"), 1_480);
    near(size("contact"), 1_260);
    near(size("emailed"), 1_202);
    expect(size("replied")).toBe(96);
    expect(size("kit")).toBe(38);
    expect(size("audience")).toBe(22);
    expect(size("signed")).toBe(16);
    const interested = new Set(
      history.gratovo.messages
        .filter((m) => m.direction === "in" && m.reading !== null)
        .map((m) => m.channel_id),
    );
    // The first reply of each replied creator reads interested, a question or a rate.
    const firstReading = new Map<string, string>();
    for (const m of history.gratovo.messages) {
      if (m.direction !== "in" || m.reading === null || firstReading.has(m.channel_id)) continue;
      firstReading.set(m.channel_id, (JSON.parse(m.reading) as { replyType: string }).replyType);
    }
    const positive = [...(reached.get("replied") ?? [])].filter((id) =>
      ["inf.interested_vague", "inf.gives_rate", "inf.who_are_you", "inf.media_kit"].includes(
        firstReading.get(id) ?? "",
      ),
    );
    expect(interested.size).toBeGreaterThan(96);
    expect(positive).toHaveLength(54);
  });

  it("has 41 keywords with the planned story", () => {
    const h = history;
    expect(h.pipeline.keywords).toHaveLength(41);
    expect(h.pipeline.archive.keywords).toHaveLength(41);
    // Primary keyword of each live and waiting channel: its first link.
    const primary = new Map<string, string>();
    for (const l of h.pipeline.links)
      if (!primary.has(l.channel_id)) primary.set(l.channel_id, l.keyword);
    const signedBy = new Map<string, number>();
    const emailedBy = new Map<string, number>();
    const repliedBy = new Map<string, number>();
    const reached = everReached(h);
    const count = (map: Map<string, number>, id: string): void => {
      const k = primary.get(id) ?? "?";
      map.set(k, (map.get(k) ?? 0) + 1);
    };
    for (const id of reached.get("signed") ?? []) count(signedBy, id);
    for (const id of reached.get("emailed") ?? []) count(emailedBy, id);
    for (const id of reached.get("replied") ?? []) count(repliedBy, id);
    const top = [...signedBy.entries()].sort((a, b) => b[1] - a[1]);
    expect(
      top
        .slice(0, 2)
        .map((x) => x[0])
        .sort(),
    ).toEqual(["ai agents tutorial", "local llm setup"]);
    expect(signedBy.get("cursor ai coding")).toBeGreaterThanOrEqual(2);
    // The most found, and nobody answers.
    const foundMost = [...h.pipeline.keywords].sort(
      (a, b) => b.channels_found - a.channels_found,
    )[0];
    expect(foundMost?.keyword).toBe("ai news weekly");
    expect(emailedBy.get("ai news weekly") ?? 0).toBeGreaterThanOrEqual(50);
    expect(repliedBy.get("ai news weekly") ?? 0).toBe(0);
    // Too early: first run about three weeks ago, few emailed.
    const videoTools = h.pipeline.keywords.find((k) => k.keyword === "ai video tools");
    const added = Date.parse(videoTools?.added_at ?? "");
    expect(now - added).toBeGreaterThan(19 * DAY);
    expect(now - added).toBeLessThan(23 * DAY);
    expect(emailedBy.get("ai video tools") ?? 0).toBeLessThan(20);
    // Worn out: its last run is mostly archived channels.
    const runs = h.pipeline.runs;
    const lastRun = runs[runs.length - 1];
    const from = Date.parse(lastRun?.started_at ?? "");
    const to = Date.parse(lastRun?.finished_at ?? "");
    const fresh = h.pipeline.links.filter((l) => {
      const t = Date.parse(l.discovered_at);
      return l.keyword === "chatgpt tips" && t >= from && t <= to;
    }).length;
    const refound = h.pipeline.pending.filter(
      (p) => p.keyword === "chatgpt tips" && Date.parse(p.discovered_at) >= from,
    ).length;
    expect(refound / (refound + fresh)).toBeGreaterThanOrEqual(0.85);
  });

  it("has a run on most working days and a catalog that grows", () => {
    const runs = history.pipeline.runs;
    expect(runs.length).toBeGreaterThan(95);
    expect(runs.length).toBeLessThan(130);
    const weeks = history.gratovo.weeks;
    expect(weeks).toHaveLength(26);
    for (let i = 1; i < weeks.length; i += 1) {
      expect(weeks[i]?.archive ?? 0).toBeGreaterThanOrEqual(weeks[i - 1]?.archive ?? 0);
    }
    expect(history.gratovo.settings).toEqual({
      archiveDays: 90,
      goal: { signsPerMonth: 4, revenuePerMonth: 10_000 },
    });
  });
});

describe("the emails", () => {
  const sentAt = (h: ExampleHistory): number[] =>
    h.gratovo.messages.filter((m) => m.direction === "out").map((m) => m.at);

  it("ramps up and uses the seed's mailboxes about half", () => {
    const firsts = history.gratovo.messages.filter((m) => m.kind === "first");
    near(firsts.length, 1_202, 0.15);
    const perDay = (from: number, to: number): number =>
      firsts.filter((m) => m.at >= from && m.at < to).length / 5;
    expect(perDay(now - 190 * DAY, now - 160 * DAY) * 5).toBeLessThan(40);
    expect(perDay(now - 8 * DAY, now - DAY)).toBeGreaterThan(10);
    const addresses = new Set(exampleSeed(now).mailSettings.mailboxes.map((m) => m.address));
    for (const m of history.gratovo.messages) expect(addresses.has(m.mailbox)).toBe(true);
    const week = sentAt(history).filter((t) => t >= now - 7 * DAY).length;
    const room = 80 * 5;
    expect(week / room).toBeGreaterThan(0.3);
    expect(week / room).toBeLessThan(0.8);
  });

  it("sends follow-ups at days 3, 7 and 14, only to those who have not replied", () => {
    const firstAt = new Map<string, number>();
    const inAt = new Map<string, number>();
    for (const m of history.gratovo.messages) {
      if (m.kind === "first") firstAt.set(m.channel_id, m.at);
      if (m.direction === "in" && !inAt.has(m.channel_id)) inAt.set(m.channel_id, m.at);
    }
    let followUps = 0;
    for (const m of history.gratovo.messages) {
      if (m.kind !== "followUp") continue;
      followUps += 1;
      const first = firstAt.get(m.channel_id) ?? Number.POSITIVE_INFINITY;
      const wanted = [0, 3, 7, 14][m.follow_up ?? 0] ?? 0;
      expect(m.at).toBeGreaterThan(first + (wanted - 0.5) * DAY);
      expect(m.at).toBeLessThan(first + (wanted + 4) * DAY);
      expect(inAt.get(m.channel_id) ?? Number.POSITIVE_INFINITY).toBeGreaterThan(m.at);
    }
    expect(followUps).toBeGreaterThan(900);
  });

  it("gets replies at every step, a few bounces and better replies when edited", () => {
    const byChannel = new Map<string, typeof history.gratovo.messages>();
    for (const m of history.gratovo.messages) {
      const list = byChannel.get(m.channel_id) ?? [];
      list.push(m);
      byChannel.set(m.channel_id, list);
    }
    const sent = [0, 0, 0, 0];
    const replied = [0, 0, 0, 0];
    let editedFirsts = 0;
    let editedReplied = 0;
    let plainFirsts = 0;
    let plainReplied = 0;
    let bounces = 0;
    let firsts = 0;
    for (const list of byChannel.values()) {
      const draftEdited = history.gratovo.drafts.length > 0;
      expect(draftEdited).toBe(true);
      const outs = list.filter((m) => m.kind === "first" || m.kind === "followUp");
      const reply = list.find(
        (m) => m.direction === "in" && !(m.reading ?? "").includes("any.bounce"),
      );
      const bounce = list.some((m) => (m.reading ?? "").includes("any.bounce"));
      let step = 0;
      for (const m of outs) {
        if (reply !== undefined && m.at > reply.at) continue;
        const n = m.follow_up ?? 0;
        sent[n] = (sent[n] ?? 0) + 1;
        step = n;
      }
      if (reply !== undefined) replied[step] = (replied[step] ?? 0) + 1;
      if (outs.some((m) => m.kind === "first")) {
        firsts += 1;
        if (bounce) bounces += 1;
      }
    }
    const edited = new Set(
      history.gratovo.drafts
        .filter((d) => d.kind === "first" && d.edited === 1)
        .map((d) => d.channel_id),
    );
    const repliers = new Set(
      history.gratovo.messages
        .filter((m) => m.direction === "in" && !(m.reading ?? "").includes("any.bounce"))
        .map((m) => m.channel_id),
    );
    for (const d of history.gratovo.drafts) {
      if (d.kind !== "first") continue;
      if (edited.has(d.channel_id)) {
        editedFirsts += 1;
        if (repliers.has(d.channel_id)) editedReplied += 1;
      } else {
        plainFirsts += 1;
        if (repliers.has(d.channel_id)) plainReplied += 1;
      }
    }
    const rate = (n: number, d: number): number => (d === 0 ? 0 : n / d);
    for (const step of [0, 1, 2, 3]) expect(replied[step] ?? 0).toBeGreaterThan(0);
    expect(rate(replied[2] ?? 0, sent[2] ?? 0)).toBeGreaterThan(
      0.5 * rate(replied[0] ?? 0, sent[0] ?? 0),
    );
    const bounceRate = bounces / firsts;
    expect(bounceRate).toBeGreaterThan(0.012);
    expect(bounceRate).toBeLessThan(0.03);
    expect(editedFirsts / (editedFirsts + plainFirsts)).toBeGreaterThan(0.3);
    expect(editedFirsts / (editedFirsts + plainFirsts)).toBeLessThan(0.4);
    expect(rate(editedReplied, editedFirsts)).toBeGreaterThan(
      1.5 * rate(plainReplied, plainFirsts),
    );
  });

  it("reads the replies with real ids, and answers them after about five hours", () => {
    const types = new Set<string>();
    for (const m of history.gratovo.messages) {
      if (m.reading === null) continue;
      const reading = JSON.parse(m.reading) as {
        replyType: string;
        label: string;
        summary: string;
        side: string;
        corrected: boolean;
        facts: unknown[];
      };
      types.add(reading.replyType);
      expect(reading.corrected).toBe(false);
      expect(reading.facts).toEqual([]);
    }
    for (const id of [
      "inf.interested_vague",
      "inf.gives_rate",
      "inf.has_manager",
      "inf.later",
      "inf.not_interested",
      "any.bounce",
    ]) {
      expect(types.has(id)).toBe(true);
    }
    const hours: number[] = [];
    const inbound = new Map(
      history.gratovo.messages.filter((m) => m.direction === "in").map((m) => [m.id, m]),
    );
    for (const d of history.gratovo.drafts) {
      if (d.kind !== "reply" || d.reply_to === null) continue;
      const inMessage = inbound.get(d.reply_to);
      if (inMessage !== undefined) hours.push((d.send_at - inMessage.at) / HOUR);
    }
    hours.sort((a, b) => a - b);
    expect(hours.length).toBeGreaterThan(50);
    const median = hours[Math.floor(hours.length / 2)] ?? 0;
    expect(median).toBeGreaterThan(2);
    expect(median).toBeLessThan(10);
  });

  it("has one draft per sent message, with edits and rewrites", () => {
    const drafts = new Map(history.gratovo.drafts.map((d) => [d.id, d]));
    const outs = history.gratovo.messages.filter((m) => m.direction === "out");
    expect(drafts.size).toBe(outs.length);
    for (const m of outs) {
      const d = drafts.get(m.draft_id ?? "");
      expect(d?.state).toBe("sent");
      expect(d?.channel_id).toBe(m.channel_id);
    }
    expect(history.gratovo.drafts.some((d) => d.steer !== null)).toBe(true);
    const ids = history.gratovo.messages.map((m) => m.gmail_message_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("brings back about 40 in the last 90 days", () => {
    const restores = history.gratovo.log.filter((l) => l.action === "creator.restore");
    expect(restores).toHaveLength(40);
    for (const r of restores) expect(r.at_ms).toBeGreaterThan(now - 90 * DAY);
  });
});

describe("the invariants", () => {
  it("only gives events to creators that exist, in time order and stage order", () => {
    const stageIndex = new Map<string, number>(creatorStages.map((s, i) => [s, i]));
    const ids = new Set(history.gratovo.creators.map((c) => c.channel_id));
    const byChannel = new Map<string, { stage: string; at: number }[]>();
    for (const e of history.gratovo.events) {
      expect(ids.has(e.channel_id)).toBe(true);
      expect(e.source).toBe("example");
      const list = byChannel.get(e.channel_id) ?? [];
      list.push({ stage: e.stage, at: e.at });
      byChannel.set(e.channel_id, list);
    }
    for (const list of byChannel.values()) {
      let previous: { stage: string; at: number } | null = null;
      for (const e of list) {
        if (previous !== null) {
          expect(e.at).toBeGreaterThan(previous.at);
          // Order of the ladder, except after a reject: a creator brought back starts again.
          if (previous.stage !== "rejected") {
            expect(stageIndex.get(e.stage) ?? 0).toBeGreaterThanOrEqual(
              stageIndex.get(previous.stage) ?? 0,
            );
          }
        }
        previous = e;
      }
    }
    // Every creator that has events ends at the stage of its last event.
    const lastStage = new Map(
      [...byChannel].map(([id, list]) => [id, list[list.length - 1]?.stage]),
    );
    for (const c of history.gratovo.creators) {
      if (lastStage.has(c.channel_id)) expect(lastStage.get(c.channel_id)).toBe(c.creator_stage);
    }
  });

  it("puts each emailed creator's first email at its emailed event, and replies after emails", () => {
    const emailedAt = new Map(
      history.gratovo.events.filter((e) => e.stage === "emailed").map((e) => [e.channel_id, e.at]),
    );
    const firstOut = new Map<string, number>();
    const firstIn = new Map<string, number>();
    for (const m of history.gratovo.messages) {
      const map = m.direction === "out" ? firstOut : firstIn;
      if (!map.has(m.channel_id)) map.set(m.channel_id, m.at);
    }
    for (const [id, at] of emailedAt) expect(firstOut.get(id)).toBe(at);
    for (const [id, at] of firstIn) {
      expect(firstOut.get(id) ?? Number.POSITIVE_INFINITY).toBeLessThan(at);
    }
    const repliedAt = new Map(
      history.gratovo.events.filter((e) => e.stage === "replied").map((e) => [e.channel_id, e.at]),
    );
    for (const [id, at] of repliedAt) expect(firstIn.get(id)).toBe(at);
  });

  it("keeps live channels in the catalog and out of the archive, and tombstones out of both", () => {
    const channelIds = new Set(history.pipeline.channels.map((c) => c.channel_id));
    expect(channelIds.size).toBe(history.pipeline.channels.length);
    const archived = new Set(history.pipeline.archive.tuples.map((t) => `UC${t[0]}`));
    for (const id of channelIds) expect(archived.has(id)).toBe(false);
    for (const c of history.gratovo.creators) {
      if (c.creator_stage !== "rejected") expect(channelIds.has(c.channel_id)).toBe(true);
    }
    for (const id of history.gratovo.names.map((n) => n.channel_id)) {
      expect(archived.has(id)).toBe(false);
    }
    for (const p of history.pipeline.pending) expect(archived.has(p.channel_id)).toBe(true);
    for (const l of history.pipeline.links) expect(channelIds.has(l.channel_id)).toBe(true);
  });

  it("gives every dated waiting channel a reject line with a reason, due 7 days on", () => {
    const rejects = new Map<string, { reason?: string; at: number }>();
    for (const l of history.gratovo.log) {
      if (l.action === "creator.reject") rejects.set(l.entity_id, { ...l.detail, at: l.at_ms });
    }
    const archiveDays = 90 * DAY;
    for (const c of history.gratovo.creators) {
      if (c.creator_stage !== "rejected" || c.archive_due_at === null) continue;
      const line = rejects.get(c.channel_id);
      expect(line).toBeDefined();
      expect(rejectReasons as readonly string[]).toContain(line?.reason);
      expect(Date.parse(c.archive_due_at)).toBe((line?.at ?? 0) + 7 * DAY);
      // Still inside the owner's 90 days.
      expect(now - (line?.at ?? 0)).toBeLessThan(archiveDays);
    }
  });

  it("ends the weekly totals at the current counts", () => {
    const g = groups(history);
    const last = history.gratovo.weeks[history.gratovo.weeks.length - 1];
    expect(last?.waiting).toBe(g["waiting"]);
    expect(last?.live).toBe(history.pipeline.channels.length - (g["waiting"] ?? 0));
    expect(last?.archive).toBe(history.pipeline.archive.tuples.length);
  });

  it("makes ids that are valid and never clash with the seed's, the catalog's or the tombstones'", () => {
    const seed = exampleSeed(now);
    const taken = new Set<string>(seed.creators.map((c) => c.id));
    for (const m of seed.outreach.messages) taken.add(m.creator);
    // The seed's creators are catalog channels too (plan P1, F6): they are the history's
    // channels' only legitimate overlap, and each is there exactly once.
    const seedIds = new Set(seed.creators.map((c) => c.id));
    const inCatalog = history.pipeline.channels.map((c) => c.channel_id);
    for (const id of seedIds) expect(inCatalog.filter((x) => x === id)).toHaveLength(1);
    const ids = [
      ...inCatalog.filter((id) => !seedIds.has(id)),
      ...history.pipeline.archive.tuples.map((t) => `UC${t[0]}`),
    ];
    const seen = new Set<string>();
    for (const id of ids) {
      if (!idPattern.test(id)) throw new Error(`Bad id ${id}`);
      if (seen.has(id) || taken.has(id)) throw new Error(`Id clash ${id}`);
      seen.add(id);
    }
    expect(seen.size).toBe(ids.length);
    for (const c of history.gratovo.creators) expect(seen.has(c.channel_id)).toBe(true);
    for (const l of history.gratovo.log) expect(seen.has(l.entity_id)).toBe(true);
    for (const t of history.pipeline.archive.tuples.slice(0, 50)) {
      expect(t[1]).toBeLessThan(history.pipeline.archive.names.length);
      expect(t[3]).toBeLessThan(history.pipeline.archive.labels.length);
      expect(t[4]).toBeLessThan(history.pipeline.archive.keywords.length);
    }
  });

  it("keeps the log and the stage in step", () => {
    const stage = new Map(history.gratovo.creators.map((c) => [c.channel_id, c.creator_stage]));
    for (const l of history.gratovo.log) {
      expect(["creator.shortlist", "creator.reject", "creator.restore", "creator.never"]).toContain(
        l.action,
      );
      if (l.action === "creator.never") expect(stage.get(l.entity_id)).toBe("never");
      expect(l.detail.text.length).toBeGreaterThan(0);
    }
    expect(history.gratovo.log.filter((l) => l.action === "creator.never")).toHaveLength(104);
  });
});

describe("the scenarios", () => {
  it("broke has a bouncing mailbox, almost no fuel and a review backlog", () => {
    const broke = required(exampleHistory(now, "broke"));
    const week = broke.gratovo.messages.filter(
      (m) => m.direction === "out" && m.at >= now - 7 * DAY,
    );
    const bounced = broke.gratovo.messages.filter(
      (m) => m.reading?.includes("any.bounce") === true && m.at >= now - 7 * DAY,
    );
    const rates = new Map<string, { sent: number; bounced: number }>();
    for (const m of week) {
      const row = rates.get(m.mailbox) ?? { sent: 0, bounced: 0 };
      row.sent += 1;
      rates.set(m.mailbox, row);
    }
    for (const m of bounced) {
      const row = rates.get(m.mailbox);
      if (row !== undefined) row.bounced += 1;
    }
    const bad = [...rates.values()].filter((r) => r.sent >= 20 && r.bounced / r.sent > 0.03);
    expect(bad.length).toBeGreaterThanOrEqual(1);
    const g = groups(broke);
    const fuel = broke.gratovo.creators.filter((c) => c.creator_stage === "contact").length;
    expect(fuel).toBeLessThanOrEqual(10);
    near(g["notReviewed"] ?? 0, 1_200);
    near(g["shortlisted"] ?? 0, 290);
    const last = broke.gratovo.weeks[broke.gratovo.weeks.length - 1];
    expect(last?.live).toBe(broke.pipeline.channels.length - (g["waiting"] ?? 0));
    // Normal has none of the three.
    const normalWeek = history.gratovo.messages.filter(
      (m) => m.direction === "out" && m.at >= now - 7 * DAY,
    );
    const normalBounces = history.gratovo.messages.filter(
      (m) => m.reading?.includes("any.bounce") === true && m.at >= now - 7 * DAY,
    );
    expect(normalBounces.length / normalWeek.length).toBeLessThan(0.03);
    expect(groups(history)["notReviewed"]).toBeLessThan(400);
  }, 20_000);

  it("has about 37 likely mistakes waiting, 9 leaving tomorrow", () => {
    const channels = new Map(history.pipeline.channels.map((c) => [c.channel_id, c]));
    const home = new Set(["US", "GB", "CA", "AU"]);
    const mistakes = history.gratovo.creators.filter((c) => {
      if (c.creator_stage !== "rejected") return false;
      const ch = channels.get(c.channel_id);
      return (
        ch !== undefined &&
        (ch.median_views_last_30 ?? 0) >= 90_000 &&
        ch.videos_last_30 >= 4 &&
        ch.videos_last_30 <= 20 &&
        home.has(ch.country ?? "") &&
        (JSON.parse(ch.seen_brands) as string[]).length > 0
      );
    });
    near(mistakes.length, 37, 0.1);
    const tomorrow = mistakes.filter((c) => {
      const leaves = Date.parse(c.archive_due_at ?? "") + 83 * DAY;
      return leaves > now && leaves <= now + DAY;
    });
    expect(tomorrow.length).toBeGreaterThanOrEqual(9);
  });
});

describe("the seed's creators as catalog channels (plan P1, F6)", () => {
  const seed = exampleSeed(now);
  const seedIds = new Set(seed.creators.map((c) => c.id));

  it("puts every seed creator in the catalog with its facts and a keyword link", () => {
    const channels = new Map(history.pipeline.channels.map((c) => [c.channel_id, c]));
    const linked = new Set(history.pipeline.links.map((l) => l.channel_id));
    seed.channels.forEach((channel, i) => {
      const row = channels.get(channel.id);
      expect(row, channel.id).toBeDefined();
      expect(row?.name).toBe(seed.creators[i]?.name);
      expect(row?.handle).toBe(seed.creators[i]?.handle);
      expect(row?.subscribers).toBe(String(channel.subscribers));
      expect(row?.median_views_last_30).toBe(channel.medianViews);
      expect(row?.videos_last_30).toBe(channel.uploads30);
      expect(JSON.parse(row?.seen_brands ?? "[]")).toEqual(channel.sponsors);
      expect(JSON.parse(row?.found_emails ?? "[]")).toEqual(channel.emails);
      expect(linked.has(channel.id)).toBe(true);
    });
    // None of them is a tombstone, and none has a history creator row of its own.
    for (const t of history.pipeline.archive.tuples.slice(0, 2000)) {
      expect(seedIds.has(`UC${t[0]}`)).toBe(false);
    }
    for (const c of history.gratovo.creators) expect(seedIds.has(c.channel_id)).toBe(false);
  });

  it("keeps the seed's names and handles out of the history's", () => {
    const names = new Set(seed.creators.map((c) => c.name.toLowerCase()));
    for (const n of history.gratovo.names) expect(names.has(n.name.toLowerCase())).toBe(false);
  });

  it("carries the seed's videos: real ids, ISO dates, views as text, newest at the latest upload", () => {
    const videos = history.pipeline.videos;
    expect(new Set(videos.map((v) => v.video_id)).size).toBe(videos.length);
    const perChannel = new Map<string, typeof videos>();
    for (const v of videos) {
      expect(v.video_id).toMatch(/^[A-Za-z0-9_-]{11}$/);
      expect(v.published_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(Date.parse(v.published_at)).toBeLessThanOrEqual(now);
      expect(v.view_count).toMatch(/^\d+$/);
      expect(v.title.length).toBeGreaterThan(0);
      perChannel.set(v.channel_id, [...(perChannel.get(v.channel_id) ?? []), v]);
    }
    expect(new Set(perChannel.keys())).toEqual(seedIds);
    const channels = new Map(history.pipeline.channels.map((c) => [c.channel_id, c]));
    for (const [id, list] of perChannel) {
      expect(list.length).toBeGreaterThanOrEqual(6);
      expect(list.length).toBeLessThanOrEqual(12);
      const newest = list.map((v) => v.published_at).sort()[list.length - 1];
      expect(newest).toBe(channels.get(id)?.latest_upload_at);
    }
  });

  it("counts the seed's channels as live in the weekly totals, and the other scenarios too", () => {
    const last = history.gratovo.weeks[history.gratovo.weeks.length - 1];
    const waiting = groups(history)["waiting"] ?? 0;
    expect(last?.live).toBe(history.pipeline.channels.length - waiting);
    for (const scenario of ["later", "broke"] as const) {
      const other = required(exampleHistory(now, scenario));
      const videoChannels = new Set(other.pipeline.videos.map((v) => v.channel_id));
      expect(videoChannels.size).toBe(seedIds.size);
    }
  }, 20_000);
});

describe("the deals' usual views", () => {
  it("are at the creators' real scale, so a thousand views is worth $30 to $50", () => {
    const targets = new Map(
      history.gratovo.dealDetails.map((d) => [
        d.deal_id,
        (JSON.parse(d.report) as { targetViews?: number } | null)?.targetViews ?? null,
      ]),
    );
    const per1000: number[] = [];
    for (const deal of history.gratovo.deals) {
      const target = targets.get(deal.id) ?? null;
      if (target !== null && Date.parse(deal.created_at) > now - 90 * DAY) {
        per1000.push(deal.brand_price / (target / 1000));
      }
    }
    expect(per1000.length).toBeGreaterThan(10);
    const mean = per1000.reduce((a, b) => a + b, 0) / per1000.length;
    expect(mean).toBeGreaterThan(30);
    expect(mean).toBeLessThan(50);
  });
});
