import { DatabaseSync } from "node:sqlite";

import { reachSequencesMax, threadPreviewMax } from "@gratovo/core/data";
import type { NewMessage, OutreachStore, Sequence } from "@gratovo/core/data";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrate } from "../../db/migrate";
import { inTransaction } from "../sqlite-source";

import { listNotifications } from "./notifications";
import { createOutreachStore, textHash, writeDraftState, writeReplyFact } from "./outreach";

const hour = 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 20, 12, 0, 0);

let db: DatabaseSync;
let store: OutreachStore;
let applied: unknown[];
let failWrites: boolean;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  migrate(db);
  applied = [];
  failWrites = false;
  store = createOutreachStore(db, {
    transaction: (fn) => {
      inTransaction(db, fn);
    },
    applyWrites: (writes) => {
      applied.push(...writes);
      if (failWrites) {
        throw new Error("boom");
      }
    },
  });
});

afterEach(() => {
  db.close();
});

function draft(id: string, creator = "UCa", at = now - hour) {
  store.insertDraft({
    id,
    creator,
    kind: "first",
    followUp: null,
    mailbox: null,
    replyTo: null,
    at,
  });
}

function message(id: string, over: Partial<NewMessage> = {}): NewMessage {
  return {
    id,
    creator: "UCa",
    direction: "out",
    kind: "first",
    followUp: null,
    subject: "Hello",
    body: "Hi there",
    bodyCut: false,
    at: now - hour,
    mailbox: "outreach1@gratovo.example",
    peer: "a@b.example",
    peerName: null,
    conversationKey: "c:UCa",
    gmailMessageId: null,
    gmailThreadId: null,
    draftId: null,
    by: "u1",
    source: "app",
    reading: null,
    ...over,
  };
}

describe("drafts", () => {
  it("inserts a drafting draft and reads it back", () => {
    draft("d1");
    expect(store.draft("d1")).toMatchObject({
      id: "d1",
      creator: "UCa",
      kind: "first",
      state: "drafting",
      subject: "",
      body: "",
      mailbox: null,
      sendAt: null,
      proposal: null,
      gatesOk: [],
      edited: false,
      checked: true,
      rewriting: null,
      problem: null,
      approvedBy: null,
      checkedHash: null,
      steer: null,
      createdAt: now - hour,
      updatedAt: now - hour,
    });
    expect(store.draft("nope")).toBeNull();
  });

  it("updates the fields given, sets updated_at, and reports a missing draft", () => {
    draft("d1");
    const proposal = {
      status: "ready" as const,
      why: "Names the video.",
      rules: ["INF-FIRST-02"],
      findings: [{ rule: "R1", text: "ok", blocking: false }],
      gates: [{ key: "g1", kind: "claim" as const, text: "Confirm" }],
      situation: { side: "creator", stage: "first", replyType: null, summary: "Cold" },
      model: "gemini",
    };
    expect(
      store.updateDraft(
        "d1",
        {
          state: "ready",
          subject: "S",
          body: "B",
          proposal,
          mailbox: "outreach1@gratovo.example",
          problem: "bridge_off",
          gatesOk: ["g1", "g1"],
        },
        now,
      ),
    ).toBe(true);
    expect(store.draft("d1")).toMatchObject({
      state: "ready",
      subject: "S",
      body: "B",
      proposal,
      mailbox: "outreach1@gratovo.example",
      problem: "bridge_off",
      gatesOk: ["g1"],
      updatedAt: now,
      createdAt: now - hour,
    });
    expect(store.updateDraft("missing", { state: "ready" }, now)).toBe(false);
  });

  it("keeps rewriting and the last steer in one field, each changed alone", () => {
    draft("d1");
    store.updateDraft("d1", { rewriting: "shorter" }, now);
    expect(store.draft("d1")).toMatchObject({ rewriting: "shorter", steer: null });
    store.updateDraft("d1", { steer: { how: "shorter", note: "Make it shorter." } }, now);
    expect(store.draft("d1")).toMatchObject({
      rewriting: "shorter",
      steer: { how: "shorter", note: "Make it shorter." },
    });
    store.updateDraft("d1", { rewriting: null }, now);
    expect(store.draft("d1")).toMatchObject({
      rewriting: null,
      steer: { how: "shorter", note: "Make it shorter." },
    });
    store.updateDraft("d1", { steer: null }, now);
    expect(store.draft("d1")?.steer).toBeNull();
    expect(db.prepare("SELECT steer FROM outreach_drafts").get()?.["steer"]).toBeNull();
  });

  it("says checked when unedited or when the check ran on this exact text", () => {
    draft("d1");
    store.updateDraft("d1", { subject: "S", body: "B", edited: true }, now);
    expect(store.draft("d1")?.checked).toBe(false);
    store.updateDraft("d1", { checkedHash: textHash("S", "B") }, now);
    expect(store.draft("d1")?.checked).toBe(true);
    store.updateDraft("d1", { body: "B2" }, now);
    expect(store.draft("d1")?.checked).toBe(false);
    store.updateDraft("d1", { edited: false }, now);
    expect(store.draft("d1")?.checked).toBe(true);
    expect(textHash("S", "B")).toMatch(/^[0-9a-f]{64}$/);
    expect(textHash("S", "B")).not.toBe(textHash("S\nB", ""));
  });

  it("reads bad JSON columns as the empty value and never throws", () => {
    draft("d1");
    db.exec(
      "UPDATE outreach_drafts SET proposal = '{oops', gates_ok = 'nope', steer = '[1', problem = 'weird'",
    );
    expect(store.draft("d1")).toMatchObject({
      proposal: null,
      gatesOk: [],
      rewriting: null,
      steer: null,
      problem: null,
    });
    db.exec('UPDATE outreach_drafts SET proposal = \'{"status":"bogus"}\', gates_ok = \'[1,"a"]\'');
    expect(store.draft("d1")).toMatchObject({ proposal: null, gatesOk: ["a"] });
    expect(store.reachParts(now).drafts).toHaveLength(1);
  });

  it("lists drafts by state oldest first, and finds the open draft newest first", () => {
    draft("d1", "UCa", now - 3 * hour);
    draft("d2", "UCa", now - 2 * hour);
    draft("d3", "UCb", now - hour);
    store.updateDraft("d1", { state: "sent" }, now);
    expect(store.draftsIn(["drafting"]).map((d) => d.id)).toEqual(["d2", "d3"]);
    expect(store.draftsIn(["sent", "drafting"]).map((d) => d.id)).toEqual(["d1", "d2", "d3"]);
    expect(store.draftsIn([])).toEqual([]);
    expect(store.openDraft("UCa")?.id).toBe("d2");
    store.updateDraft("d2", { state: "skipped" }, now);
    expect(store.openDraft("UCa")).toBeNull();
  });
});

describe("reachParts", () => {
  it("keeps open drafts, and sent or skipped ones for 24 hours; newest first, without main-only fields", () => {
    draft("open", "UCa", now - 50 * hour);
    draft("sentNew", "UCb", now - 30 * hour);
    draft("sentOld", "UCc", now - 40 * hour);
    draft("skippedEdge", "UCd", now - 20 * hour);
    draft("fresh", "UCe", now - hour);
    store.updateDraft("sentNew", { state: "sent" }, now - 23 * hour);
    store.updateDraft("sentOld", { state: "sent" }, now - 25 * hour);
    store.updateDraft("skippedEdge", { state: "skipped" }, now - 24 * hour);
    const drafts = store.reachParts(now).drafts;
    expect(drafts.map((d) => d.id)).toEqual(["fresh", "skippedEdge", "sentNew", "open"]);
    expect(drafts[0]).not.toHaveProperty("approvedBy");
    expect(drafts[0]).not.toHaveProperty("checkedHash");
    expect(drafts[0]).not.toHaveProperty("steer");
  });

  it("makes one summary per creator with messages", () => {
    store.commit({
      at: now,
      messages: [
        message("m1", { at: now - 5 * hour }),
        message("m2", {
          direction: "in",
          kind: null,
          at: now - 3 * hour,
          body: "\n\n  Which brand is it?  \nSecond line",
          reading: {
            replyType: "creator.question",
            label: "Question",
            summary: "Asks who",
            side: "creator",
            corrected: false,
            facts: [],
          },
        }),
        message("m3", { at: now - hour }),
        message("m4", {
          creator: "UCb",
          direction: "in",
          kind: null,
          at: now - 4 * hour,
          body: "x".repeat(500),
        }),
        message("m5", {
          creator: "UCc",
          direction: "in",
          kind: null,
          at: now - 2 * hour,
          body: "Delivery failed",
          reading: {
            replyType: "any.bounce",
            label: "Bounce",
            summary: "",
            side: "any",
            corrected: false,
            facts: [],
          },
        }),
        message("m6", { creator: "UCd", at: now - 6 * hour }),
      ],
    });
    const threads = store.reachParts(now).threads;
    expect(threads.map((t) => t.creator)).toEqual(["UCa", "UCc", "UCb", "UCd"]);
    const [a, c, b, d] = threads;
    expect(a).toMatchObject({
      creator: "UCa",
      count: 3,
      lastOutAt: now - hour,
      answered: true,
      lastIn: { id: "m2", at: now - 3 * hour, preview: "Which brand is it?", bounce: false },
    });
    expect(a?.lastIn?.reading?.label).toBe("Question");
    expect(c).toMatchObject({ answered: false, lastOutAt: null, lastIn: { bounce: true } });
    expect(b?.lastIn?.preview).toHaveLength(threadPreviewMax);
    expect(b?.answered).toBe(false);
    expect(d).toMatchObject({ count: 1, lastIn: null, answered: true });
  });

  it("brings the old app's emails in once, and never counts an old reply as one to answer (D19)", () => {
    const old = (id: string, over: Partial<NewMessage> = {}): NewMessage =>
      message(id, { source: "imported", kind: null, mailbox: null, by: null, ...over });
    const batch = [
      old("imported-1", { at: now - 5 * hour }),
      old("imported-2", { direction: "in", at: now - 4 * hour }),
    ];
    expect(store.importMessages(batch)).toBe(2);
    expect(store.importMessages(batch)).toBe(0);
    expect(store.thread("UCa", 10).map((m) => [m.id, m.source])).toEqual([
      ["imported-1", "imported"],
      ["imported-2", "imported"],
    ]);
    // Paste a reply counts the old mail; the drafter's "no message out" rule doesn't.
    expect(store.hasOutbound("UCa", true)).toBe(true);
    expect(store.hasOutbound("UCa", false)).toBe(false);
    expect(store.reachParts(now).threads[0]).toMatchObject({ count: 2, lastIn: null });
    // A reply that comes in later is a reply like any other.
    store.commit({
      at: now,
      messages: [message("m3", { direction: "in", kind: null, source: "sweep", at: now })],
    });
    expect(store.reachParts(now).threads[0]?.lastIn?.id).toBe("m3");
  });

  it("reads a bad reading as none", () => {
    store.commit({ at: now, messages: [message("m1", { direction: "in", kind: null })] });
    db.exec("UPDATE outreach_messages SET reading = '{oops'");
    expect(store.reachParts(now).threads[0]?.lastIn).toMatchObject({
      reading: null,
      bounce: false,
    });
    expect(store.thread("UCa", 10)[0]?.reading).toBeNull();
  });
});

describe("messages", () => {
  it("reads a thread oldest first, the newest N", () => {
    store.commit({
      at: now,
      messages: [1, 2, 3, 4].map((n) => message("m" + String(n), { at: now - (5 - n) * hour })),
    });
    expect(store.thread("UCa", 10).map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(store.thread("UCa", 2).map((m) => m.id)).toEqual(["m3", "m4"]);
    expect(store.thread("UCa", 0)).toEqual([]);
    expect(store.thread("UCz", 5)).toEqual([]);
    expect(store.thread("UCa", 1)[0]).toMatchObject({
      direction: "out",
      kind: "first",
      subject: "Hello",
      body: "Hi there",
      bodyCut: false,
      mailbox: "outreach1@gratovo.example",
      peer: "a@b.example",
      by: "u1",
      source: "app",
      reading: null,
    });
  });

  it("answers hasOutbound, recentOutbound and sentSince", () => {
    store.commit({
      at: now,
      messages: [
        message("m1", { creator: "UCa", at: now - 3 * hour, body: "one" }),
        message("m2", {
          creator: "UCb",
          at: now - 2 * hour,
          body: "two",
          mailbox: "outreach2@gratovo.example",
        }),
        message("m3", { creator: "UCc", direction: "in", kind: null, at: now - hour, body: "in" }),
        message("m4", { creator: "UCa", at: now - 30 * hour, body: "old" }),
      ],
    });
    expect(store.hasOutbound("UCa", false)).toBe(true);
    expect(store.hasOutbound("UCc", false)).toBe(false);
    expect(store.recentOutbound(2)).toEqual([
      { creator: "UCb", body: "two" },
      { creator: "UCa", body: "one" },
    ]);
    expect(store.sentSince(now - 24 * hour)).toEqual([
      { mailbox: "outreach1@gratovo.example", count: 1 },
      { mailbox: "outreach2@gratovo.example", count: 1 },
    ]);
  });

  it("counts a mailbox's sends, bounces, first emails and answers, ignoring the case", () => {
    const day = 24 * hour;
    const bounce = {
      replyType: "any.bounce",
      label: "Bounce",
      summary: "",
      side: "",
      corrected: false,
      facts: [],
    };
    const friendly = { ...bounce, replyType: "creator.interested", label: "Interested" };
    const m1 = "Outreach1@Gratovo.example";
    store.commit({
      at: now,
      messages: [
        // Three first emails in the last week, one from the same creator twice (counts once).
        message("o1", { creator: "UCa", at: now - 2 * day, mailbox: m1 }),
        message("o2", { creator: "UCb", at: now - 3 * day }),
        message("o3", { creator: "UCc", at: now - day }),
        message("o4", { creator: "UCa", at: now - day, kind: "followUp" }),
        // 10 days ago: in the 30-day window but not the 7-day one.
        message("o5", { creator: "UCd", at: now - 10 * day }),
        // 40 days ago: outside both.
        message("o6", { creator: "UCe", at: now - 40 * day }),
        // Another mailbox.
        message("o7", { creator: "UCf", at: now - day, mailbox: "outreach2@gratovo.example" }),
        // UCa answers (friendly), UCb's address bounced, UCd answers with no reading.
        message("i1", {
          creator: "UCa",
          direction: "in",
          kind: null,
          at: now - day,
          reading: friendly,
        }),
        message("i2", {
          creator: "UCb",
          direction: "in",
          kind: null,
          at: now - 2 * day,
          reading: bounce,
        }),
        message("i3", { creator: "UCd", direction: "in", kind: null, at: now - 9 * day }),
        // A bounce 8 days ago is out of the 7-day window; one before the first email is no answer.
        message("i4", {
          creator: "UCc",
          direction: "in",
          kind: null,
          at: now - 8 * day,
          reading: bounce,
        }),
      ],
    });
    const counts = store.mailboxCounts(now);
    expect([...counts.keys()].sort()).toEqual([
      "outreach1@gratovo.example",
      "outreach2@gratovo.example",
    ]);
    expect(counts.get("outreach1@gratovo.example")).toEqual({
      sent7: 4,
      bounced7: 1,
      firsts30: 4,
      replied30: 2,
    });
    expect(counts.get("outreach2@gratovo.example")).toEqual({
      sent7: 1,
      bounced7: 0,
      firsts30: 1,
      replied30: 0,
    });
  });

  it("counts an unread daemon bounce as a bounce, and an answer only for the mailbox it reached", () => {
    const day = 24 * hour;
    const m2 = "outreach2@gratovo.example";
    store.commit({
      at: now,
      messages: [
        // UCa got first emails from both mailboxes; it answered outreach2 only.
        message("o1", { creator: "UCa", at: now - 3 * day }),
        message("o2", { creator: "UCa", at: now - 3 * day, mailbox: m2 }),
        message("i1", { creator: "UCa", direction: "in", kind: null, at: now - day, mailbox: m2 }),
        // UCb's address bounced; the bounce is not read yet.
        message("o3", { creator: "UCb", at: now - 3 * day }),
        message("i2", {
          creator: "UCb",
          direction: "in",
          kind: null,
          at: now - 2 * day,
          peer: "MAILER-DAEMON@googlemail.com",
        }),
      ],
    });
    const counts = store.mailboxCounts(now);
    expect(counts.get("outreach1@gratovo.example")).toMatchObject({
      bounced7: 1,
      firsts30: 2,
      replied30: 0,
    });
    expect(counts.get(m2)).toMatchObject({ firsts30: 1, replied30: 1 });
  });

  it("cuts a body to the limit and marks it cut", () => {
    store.commit({ at: now, messages: [message("m1", { body: "x".repeat(100_001) })] });
    const stored = store.thread("UCa", 1)[0];
    expect(stored?.body).toHaveLength(100_000);
    expect(stored?.bodyCut).toBe(true);
  });
});

describe("sequences", () => {
  const sequence: Sequence = {
    creator: "UCa",
    mailbox: "outreach1@gratovo.example",
    startedAt: now - hour,
    steps: [
      { n: 1, dueAt: now + hour, state: "planned", sentAt: null },
      { n: 2, dueAt: now + 2 * hour, state: "sent", sentAt: now },
    ],
    stopped: null,
    parkUntil: null,
  };

  it("stores, replaces and reads a sequence; bad steps read as none", () => {
    store.commit({ at: now, sequences: [sequence] });
    expect(store.sequence("UCa")).toEqual(sequence);
    expect(store.reachParts(now).sequences).toEqual([sequence]);
    store.commit({ at: now, sequences: [{ ...sequence, stopped: "replied" }] });
    expect(store.sequence("UCa")?.stopped).toBe("replied");
    expect(db.prepare("SELECT conversation_key FROM outreach_sequences").get()).toEqual({
      conversation_key: "c:UCa",
    });
    db.exec("UPDATE outreach_sequences SET steps = '{oops'");
    expect(store.sequence("UCa")?.steps).toEqual([]);
    expect(store.sequence("UCz")).toBeNull();
  });
});

describe("the sequences in the frame", () => {
  const day = 24 * hour;
  const at = (creator: string, over: Partial<Sequence> = {}): Sequence => ({
    creator,
    mailbox: "outreach1@gratovo.example",
    startedAt: now - 5 * day,
    steps: [{ n: 1, dueAt: now + hour, state: "planned", sentAt: null }],
    stopped: null,
    parkUntil: null,
    ...over,
  });
  const ids = (): string[] => store.reachParts(now).sequences.map((q) => q.creator);

  it("lists the running, parked and stopped-by-you, and recent endings, newest first", () => {
    store.commit({ at: now - 60 * day, sequences: [at("old-replied", { stopped: "replied" })] });
    store.commit({ at: now - 60 * day, sequences: [at("old-you", { stopped: "you" })] });
    store.commit({
      at: now - 60 * day,
      sequences: [at("old-running", { startedAt: now - 70 * day })],
    });
    store.commit({ at: now - 60 * day, sequences: [at("old-parked", { parkUntil: now + day })] });
    store.commit({ at: now - 2 * day, sequences: [at("new-bounced", { stopped: "bounced" })] });
    store.commit({ at: now - 2 * day, sequences: [at("new-finished", { stopped: "finished" })] });
    store.commit({ at: now, sequences: [at("fresh", { startedAt: now - day })] });
    expect(ids()).toEqual([
      "fresh",
      "new-bounced",
      "new-finished",
      "old-parked",
      "old-you",
      "old-running",
    ]);
  });

  it("is capped at reachSequencesMax, and the day timer's own list is not", () => {
    const many = Array.from({ length: reachSequencesMax + 50 }, (_, i) =>
      at(`UC${String(i)}`, { startedAt: now - i }),
    );
    store.commit({ at: now, sequences: many });
    const listed = store.reachParts(now).sequences;
    expect(listed).toHaveLength(reachSequencesMax);
    // Newest first: the cap drops the oldest.
    expect(listed[0]?.creator).toBe("UC0");
    expect(store.runningSequences()).toHaveLength(reachSequencesMax + 50);
  });

  it("inserts a new draft and the sequence in one transaction", () => {
    store.commit({
      at: now,
      newDrafts: [
        {
          id: "n1",
          creator: "UCa",
          kind: "followUp",
          followUp: 1,
          mailbox: null,
          replyTo: null,
          at: now,
        },
      ],
      sequences: [at("UCa")],
    });
    expect(store.draft("n1")?.state).toBe("drafting");
    expect(store.sequence("UCa")).not.toBeNull();
    // A draft row that can't go in takes the sequence with it.
    expect(() => {
      store.commit({
        at: now,
        newDrafts: [
          {
            id: "n1",
            creator: "UCb",
            kind: "followUp",
            followUp: 1,
            mailbox: null,
            replyTo: null,
            at: now,
          },
        ],
        sequences: [at("UCb")],
      });
    }).toThrow();
    expect(store.sequence("UCb")).toBeNull();
  });
});

describe("skipping a follow-up's draft", () => {
  const steps = (): string[] => (store.sequence("UCa")?.steps ?? []).map((x) => x.state);
  function followUp(id: string, n: number): void {
    store.insertDraft({
      id,
      creator: "UCa",
      kind: "followUp",
      followUp: n,
      mailbox: "outreach1@gratovo.example",
      replyTo: null,
      at: now,
    });
    store.updateDraft(id, { state: "ready" }, now);
  }

  it("marks its step skipped in the same write, and an Undo puts it back to drafted", () => {
    store.commit({
      at: now,
      sequences: [
        {
          creator: "UCa",
          mailbox: "outreach1@gratovo.example",
          startedAt: now - 5 * 24 * hour,
          steps: [
            { n: 1, dueAt: now - hour, state: "sent", sentAt: now - hour },
            { n: 2, dueAt: now, state: "drafted", sentAt: null },
            { n: 3, dueAt: now + 24 * hour, state: "planned", sentAt: null },
          ],
          stopped: null,
          parkUntil: null,
        },
      ],
    });
    followUp("f2", 2);
    inTransaction(db, () => {
      writeDraftState(
        db,
        { kind: "draft.state", id: "f2", state: "skipped", sendAt: null },
        "u1",
        now,
      );
    });
    expect(store.draft("f2")?.state).toBe("skipped");
    expect(steps()).toEqual(["sent", "skipped", "planned"]);
    inTransaction(db, () => {
      writeDraftState(
        db,
        { kind: "draft.state", id: "f2", state: "ready", sendAt: null },
        "u1",
        now,
      );
    });
    expect(steps()).toEqual(["sent", "drafted", "planned"]);
  });

  it("leaves the sequence alone for a first email, a missing sequence and a sent step", () => {
    draft("first");
    store.updateDraft("first", { state: "ready" }, now);
    inTransaction(db, () => {
      writeDraftState(
        db,
        { kind: "draft.state", id: "first", state: "skipped", sendAt: null },
        "u1",
        now,
      );
    });
    followUp("f1", 1);
    inTransaction(db, () => {
      writeDraftState(
        db,
        { kind: "draft.state", id: "f1", state: "skipped", sendAt: null },
        "u1",
        now,
      );
    });
    expect(store.sequence("UCa")).toBeNull();
  });
});

describe("commit", () => {
  it("skips a message whose Gmail id is already stored", () => {
    store.commit({ at: now, messages: [message("m1", { gmailMessageId: "g1" })] });
    store.commit({
      at: now,
      messages: [message("m2", { gmailMessageId: "g1", body: "again" }), message("m3")],
    });
    expect(store.thread("UCa", 10).map((m) => m.id)).toEqual(["m1", "m3"]);
  });

  it("applies drafts, messages, sequences and then the writes in one transaction", () => {
    draft("d1");
    const write = {
      kind: "creator.stage",
      id: "UCa",
      stage: "emailed",
      handle: "@a",
      name: "A",
    } as const;
    store.commit({
      at: now,
      drafts: [{ id: "d1", patch: { state: "sent" } }],
      messages: [message("m1")],
      writes: [write],
    });
    expect(store.draft("d1")?.state).toBe("sent");
    expect(store.draft("d1")?.updatedAt).toBe(now);
    expect(store.hasOutbound("UCa", false)).toBe(true);
    expect(applied).toEqual([write]);
  });

  it("rolls everything back when a write throws", () => {
    draft("d1");
    failWrites = true;
    expect(() => {
      store.commit({
        at: now,
        drafts: [{ id: "d1", patch: { state: "sent" } }],
        messages: [message("m1")],
        sequences: [
          {
            creator: "UCa",
            mailbox: "outreach1@gratovo.example",
            startedAt: now,
            steps: [],
            stopped: null,
            parkUntil: null,
          },
        ],
        writes: [{ kind: "notify.set", notify: {} }],
      });
    }).toThrow("boom");
    expect(db.isTransaction).toBe(false);
    expect(store.draft("d1")?.state).toBe("drafting");
    expect(store.hasOutbound("UCa", false)).toBe(false);
    expect(store.sequence("UCa")).toBeNull();
  });
});

// --- replies (plan step 6d, D23) ---

const readingWithFacts = {
  replyType: "inf.gives_rate",
  label: "Gives their rate or rate card",
  summary: "They gave a price.",
  side: "influencer",
  corrected: false,
  facts: [
    { key: "rate" as const, rate: 1200, saved: false },
    {
      key: "countries" as const,
      countries: [
        { code: "US", share: 55 },
        { code: "GB", share: null },
      ],
      saved: false,
    },
    { key: "age" as const, band: "25-34", saved: false },
  ],
};

function channel(id: string, provided: string | null = null): void {
  db.prepare(
    "INSERT INTO channel_state (channel_id, handle, provided_data, updated_at) VALUES (?, ?, ?, ?)",
  ).run(id, `@${id}`, provided, new Date(now).toISOString());
}

const providedOf = (id: string): unknown => {
  const row = db.prepare("SELECT provided_data FROM channel_state WHERE channel_id = ?").get(id);
  return row?.["provided_data"] === null ? null : JSON.parse(String(row?.["provided_data"]));
};

describe("one message and the Gmail ids", () => {
  it("reads a message by id with its creator, Gmail id and saved facts", () => {
    store.commit({
      at: now,
      messages: [
        message("m1", {
          direction: "in",
          kind: null,
          gmailMessageId: "g-1",
          reading: readingWithFacts,
        }),
      ],
    });
    expect(store.message("m1")).toMatchObject({
      id: "m1",
      creator: "UCa",
      direction: "in",
      gmailMessageId: "g-1",
      factsSaved: [],
      reading: { replyType: "inf.gives_rate", corrected: false },
    });
    expect(store.message("nope")).toBeNull();
  });

  it("says which Gmail ids are stored", () => {
    store.commit({
      at: now,
      messages: [
        message("m1", { gmailMessageId: "g-1" }),
        message("m2", { gmailMessageId: "g-2" }),
      ],
    });
    expect(store.storedGmailIds(["g-1", "g-3", "g-2", "g-4"])).toEqual(new Set(["g-1", "g-2"]));
    expect(store.storedGmailIds([])).toEqual(new Set());
  });
});

describe("a reading and a notification in a commit", () => {
  it("sets a reading, and adds a notification by id that is never about money", () => {
    store.commit({ at: now, messages: [message("m1", { direction: "in", kind: null })] });
    const notification = {
      id: "reply-m1",
      at: now,
      icon: "reply" as const,
      text: "Vector Vlog replied",
      sub: "Re: Your video",
      go: { screen: "reach", tab: "inbox" },
      read: false,
    };
    store.commit({
      at: now,
      readings: [{ id: "m1", reading: readingWithFacts }],
      notifications: [notification],
    });
    expect(store.message("m1")?.reading).toMatchObject({ label: "Gives their rate or rate card" });
    expect(listNotifications(db)).toEqual([notification]);
    // The same id replaces: a second commit is not a second notification.
    store.commit({ at: now, notifications: [{ ...notification, text: "Again" }] });
    expect(listNotifications(db).map((n) => n.text)).toEqual(["Again"]);
  });

  it("rolls the reading and the notification back with a failing write", () => {
    store.commit({ at: now, messages: [message("m1", { direction: "in", kind: null })] });
    failWrites = true;
    expect(() => {
      store.commit({
        at: now,
        readings: [{ id: "m1", reading: readingWithFacts }],
        notifications: [
          {
            id: "n1",
            at: now,
            icon: "alert",
            text: "x",
            sub: "",
            go: { screen: "reach", tab: null },
            read: false,
          },
        ],
        writes: [{ kind: "notify.set", notify: {} }],
      });
    }).toThrow("boom");
    expect(store.message("m1")?.reading).toBeNull();
    expect(listNotifications(db)).toEqual([]);
  });
});

describe("reply.fact", () => {
  const sweepIn = (): void => {
    store.commit({
      at: now,
      messages: [
        message("m1", { direction: "in", kind: null, source: "sweep", reading: readingWithFacts }),
      ],
    });
  };
  const fact = (key: "rate" | "countries" | "age") =>
    ({ kind: "reply.fact", messageId: "m1", key }) as const;

  it("merges each fact into provided_data and keeps the other keys", () => {
    channel("UCa", JSON.stringify({ gender: "f", rate: 900 }));
    sweepIn();
    writeReplyFact(db, fact("rate"));
    expect(providedOf("UCa")).toEqual({ gender: "f", rate: 1200 });
    writeReplyFact(db, fact("countries"));
    writeReplyFact(db, fact("age"));
    expect(providedOf("UCa")).toEqual({
      gender: "f",
      rate: 1200,
      countries: [
        { code: "US", share: 55 },
        { code: "GB", share: null },
      ],
      age: "25-34",
    });
  });

  it("starts from nothing, and from a provided_data that is not an object", () => {
    channel("UCa", null);
    sweepIn();
    writeReplyFact(db, fact("age"));
    expect(providedOf("UCa")).toEqual({ age: "25-34" });
    db.prepare("UPDATE channel_state SET provided_data = '[1,2]' WHERE channel_id = 'UCa'").run();
    writeReplyFact(db, fact("rate"));
    expect(providedOf("UCa")).toEqual({ rate: 1200 });
  });

  it("marks the fact saved on the message, in the thread and the frame, once", () => {
    channel("UCa");
    sweepIn();
    writeReplyFact(db, fact("rate"));
    writeReplyFact(db, fact("rate"));
    expect(store.message("m1")?.factsSaved).toEqual(["rate"]);
    const saved = (facts: readonly { key: string; saved: boolean }[] | undefined) =>
      facts?.map((f) => [f.key, f.saved]);
    const expected = [
      ["rate", true],
      ["countries", false],
      ["age", false],
    ];
    expect(saved(store.thread("UCa", 10)[0]?.reading?.facts)).toEqual(expected);
    expect(saved(store.reachParts(now).threads[0]?.lastIn?.reading?.facts)).toEqual(expected);
  });

  it("is a no-op for an unknown message, an out message, a fact it does not hold and a channel with no row", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    channel("UCa");
    store.commit({
      at: now,
      messages: [
        message("m1", { direction: "in", kind: null, reading: readingWithFacts }),
        message("out1", { direction: "out" }),
        message("m2", {
          direction: "in",
          kind: null,
          reading: { ...readingWithFacts, facts: [] },
        }),
        message("m3", {
          creator: "UCnone",
          direction: "in",
          kind: null,
          reading: readingWithFacts,
        }),
      ],
    });
    writeReplyFact(db, { kind: "reply.fact", messageId: "nope", key: "rate" });
    writeReplyFact(db, { kind: "reply.fact", messageId: "out1", key: "rate" });
    writeReplyFact(db, { kind: "reply.fact", messageId: "m2", key: "rate" });
    writeReplyFact(db, { kind: "reply.fact", messageId: "m3", key: "rate" });
    expect(providedOf("UCa")).toBeNull();
    expect(store.message("m3")?.factsSaved).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(4);
    // The log carries the kind only.
    expect(JSON.stringify(warn.mock.calls)).not.toContain("1200");
    warn.mockRestore();
  });
});
