import { DatabaseSync } from "node:sqlite";

import { threadPreviewMax } from "@gratovo/core/data";
import type { NewMessage, OutreachStore, Sequence } from "@gratovo/core/data";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrate } from "../../db/migrate";
import { inTransaction } from "../sqlite-source";

import { createOutreachStore, textHash } from "./outreach";

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
    expect(store.hasOutbound("UCa")).toBe(true);
    expect(store.hasOutbound("UCc")).toBe(false);
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
    expect(store.hasOutbound("UCa")).toBe(true);
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
    expect(store.hasOutbound("UCa")).toBe(false);
    expect(store.sequence("UCa")).toBeNull();
  });
});
