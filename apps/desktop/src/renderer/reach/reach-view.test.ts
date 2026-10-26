import type { Sequence, ThreadSummary } from "@gratovo/core/data";
import { describe, expect, it } from "vitest";

import { strings } from "../strings";
import { aiDraft, reachWith } from "../lib/reach-test-bridge";
import { aiCreator } from "./reach-fixtures";
import { dayWords } from "../lib/reach-actions";
import { cardInfo, nextWords, sequenceEvents, sequenceRows, subLine } from "./reach-view";

const now = Date.UTC(2026, 9, 25, 12, 0, 0);
const day = 86_400_000;

describe("cardInfo for In sequence", () => {
  it("says when the email went and promises no follow-up while there is no sequence", () => {
    const info = cardInfo(
      {
        creator: aiCreator("c1", "Agent Weekly", { stage: "emailed" }),
        draft: null,
        sequence: null,
        thread: { creator: "c1", count: 1, lastOutAt: now - 2 * day, lastIn: null, answered: true },
      },
      "seq",
      now,
      null,
    );
    expect(info.sub).not.toContain(strings.reach.board.sub.lastSent);
    expect(info.sub).toContain("2");
    expect(info.chip).toBeNull();
  });

  it("names the next follow-up when a sequence runs", () => {
    const sequence: Sequence = {
      creator: "c1",
      mailbox: "outreach1@gratovo.example",
      startedAt: now - day,
      steps: [{ n: 1, dueAt: now + 2 * day, state: "planned", sentAt: null }],
      stopped: null,
      parkUntil: null,
    };
    const info = cardInfo(
      {
        creator: aiCreator("c1", "Agent Weekly", { stage: "emailed" }),
        draft: null,
        sequence,
        thread: null,
      },
      "seq",
      now,
      null,
    );
    expect(info.chip).toEqual({ kind: "due", at: now + 2 * day });
  });

  it("shows a scheduled email with its send time", () => {
    const info = cardInfo(
      {
        creator: aiCreator("c1", "Agent Weekly", { stage: "contact" }),
        draft: aiDraft("d1", "c1", { state: "scheduled", sendAt: now + day }),
        sequence: null,
        thread: null,
      },
      "seq",
      now,
      null,
    );
    expect(info.sub).toContain(strings.reach.board.sub.scheduled);
    expect(info.chip).toEqual({ kind: "due", at: now + day });
    expect(info.action).toBeNull();
  });
});

describe("cardInfo for parked, stopped and finished sequences", () => {
  const base: Sequence = {
    creator: "c1",
    mailbox: "outreach1@gratovo.example",
    startedAt: now - 3 * day,
    steps: [{ n: 1, dueAt: now + day, state: "planned", sentAt: null }],
    stopped: null,
    parkUntil: null,
  };
  const card = (sequence: Sequence) =>
    cardInfo(
      {
        creator: aiCreator("c1", "Agent Weekly", { stage: "emailed" }),
        draft: null,
        sequence,
        thread: null,
      },
      "seq",
      now,
      null,
    );

  it("says when a parked creator wakes", () => {
    const until = now + 30 * day;
    expect(card({ ...base, parkUntil: until }).sub).toBe(
      strings.reach.board.sub.parked(dayWords(until)),
    );
  });

  it("says a sequence was stopped by you, or finished", () => {
    expect(card({ ...base, stopped: "you" }).sub).toBe(strings.reach.board.sub.stopped.you);
    const done = card({ ...base, stopped: "finished" });
    expect(done.sub).toBe(strings.reach.board.sub.stopped.finished);
    expect(done.chip).toEqual({ kind: "finished" });
    const spent: Sequence = {
      ...base,
      startedAt: now - 30 * day,
      steps: [{ n: 1, dueAt: now - 27 * day, state: "sent", sentAt: now - 20 * day }],
    };
    expect(card(spent).chip).toEqual({ kind: "finished" });
  });
});

describe("the Sequences words and dots", () => {
  const sequence = (over: Partial<Sequence> = {}): Sequence => ({
    creator: "c1",
    mailbox: "outreach1@gratovo.example",
    startedAt: now - 3 * day,
    steps: [
      { n: 1, dueAt: now, state: "planned", sentAt: null },
      { n: 2, dueAt: now + 4 * day, state: "planned", sentAt: null },
    ],
    stopped: null,
    parkUntil: null,
    ...over,
  });
  const rowOf = (s: Sequence, thread = null as ThreadSummary | null) => {
    const rows = sequenceRows([aiCreator("c1", "Agent Weekly")], [s], thread ? [thread] : [], now);
    const row = rows[0];
    if (row === undefined) {
      throw new Error("no row");
    }
    return row;
  };
  const next = strings.reach.sequences.next;

  it("reads a creator at stage parked as parked, even with no day stored", () => {
    const rows = sequenceRows(
      [aiCreator("c1", "Agent Weekly", { stage: "parked" })],
      [sequence()],
      [],
      now,
    );
    const row = rows[0];
    expect(row?.state).toBe("parked");
    expect(row === undefined ? null : nextWords(row, now).text).toBe(next.parkedNoDay);
  });

  it("names the next step", () => {
    expect(nextWords(rowOf(sequence()), now).text).toBe(next.step(1, next.dueToday));
    const later = sequence({
      steps: [{ n: 1, dueAt: now + 3 * day, state: "planned", sentAt: null }],
    });
    expect(nextWords(rowOf(later), now).text).toBe(next.step(1, next.inDays(3)));
    expect(nextWords(rowOf(sequence({ stopped: "you" })), now).text).toBe(next.you);
    expect(nextWords(rowOf(sequence({ stopped: "replied" })), now).text).toBe(next.replied);
    expect(nextWords(rowOf(sequence({ parkUntil: now + 14 * day })), now).text).toBe(
      next.parked(dayWords(now + 14 * day)),
    );
    const last = sequence({
      steps: [{ n: 1, dueAt: now - day, state: "sent", sentAt: now - day }],
      startedAt: now - 4 * day,
    });
    expect(nextWords(rowOf(last), now).text).toBe(next.last);
    expect(nextWords(rowOf(sequence({ stopped: "finished" })), now).text).toBe(next.finished);
  });

  it("puts a dot on each day: sent, due, planned, skipped, reply", () => {
    const s = sequence({
      steps: [
        { n: 1, dueAt: now - day, state: "skipped", sentAt: null },
        { n: 2, dueAt: now, state: "planned", sentAt: null },
        { n: 3, dueAt: now + 4 * day, state: "planned", sentAt: null },
      ],
    });
    const reply: ThreadSummary = {
      creator: "c1",
      count: 3,
      lastOutAt: now - day,
      lastIn: { id: "m", at: now - 2 * day, reading: null, preview: "Hi", bounce: false },
      answered: false,
    };
    const e = sequenceEvents(rowOf(s, reply), now);
    const types = (col: number) => e.days[col]?.map((d) => d.type);
    expect(types(14 - 3)).toEqual(["sent"]);
    expect(types(14 - 2)).toEqual(["reply"]);
    expect(types(14 - 1)).toEqual(["skip"]);
    expect(types(14)).toEqual(["due"]);
    expect(types(14 + 4)).toEqual(["plan"]);
    expect([e.lo, e.hi]).toEqual([11, 18]);
  });

  it("shows a stopped sequence's old due step as planned, and orders running first", () => {
    const stopped = sequence({ stopped: "you" });
    expect(sequenceEvents(rowOf(stopped), now).days[14]?.map((d) => d.type)).toEqual(["plan"]);
    const rows = sequenceRows(
      [aiCreator("c1", "A"), aiCreator("c2", "B")],
      [
        { ...stopped, creator: "c1" },
        { ...sequence(), creator: "c2" },
      ],
      [],
      now,
    );
    expect(rows.map((r) => r.creator.id)).toEqual(["c2", "c1"]);
  });
});

describe("subLine with the creators", () => {
  it("counts replies the way Replies does: an answer to send, or nothing written yet", () => {
    const creators = [aiCreator("c1", "Prompt Lab"), aiCreator("c2", "Neural Notes")];
    const lastIn = { id: "m", at: 1, reading: null, preview: "Hi", bounce: false };
    const threads = ["c1", "c2"].map((creator) => ({
      creator,
      count: 2,
      lastOutAt: 0,
      lastIn,
      answered: false,
    }));
    const reach = reachWith({ threads });
    expect(subLine(reach, creators)).toContain("2 replies to answer");
    expect(subLine(reach)).not.toContain("replies to answer");
  });
});
