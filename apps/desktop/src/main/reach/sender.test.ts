import type {
  CreatorState,
  DataSource,
  DataWrite,
  DraftPatch,
  DraftProposal,
  MailboxView,
  NewMessage,
  OutreachStore,
  Sequence,
  StoredDraft,
} from "@gratovo/core/data";
import { planSteps } from "@gratovo/core/reach";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openLiveSource } from "../data/live-source";
import { textHash } from "../data/repositories/outreach";
import type { EndErrorCode } from "../pipeline/protocol";

import {
  createSender,
  holdMs,
  lateMs,
  sendVerdict,
  type CheckOutcome,
  type SendMessage,
  type SendOutcome,
  type Sender,
} from "./sender";
import { senderStrings } from "./sender-strings";

// --- fakes ---

const start = Date.UTC(2026, 9, 25, 9, 0, 0);
const me = "u1";
const kai = "UCkai000000000000000000a";
const lab = "UClab000000000000000000b";

function creator(id: string, over: Partial<CreatorState> = {}): CreatorState {
  return {
    id,
    handle: id === kai ? "@codewithkai" : "@promptlab",
    name: id === kai ? "Code with Kai" : "Prompt Lab",
    stage: "contact",
    email: id === kai ? "kai@codewithkai.com" : "hello@promptlab.ai",
    emailConfirmed: true,
    contactName: id === kai ? "Kai" : null,
    rejectReason: null,
    rejectedAt: null,
    neverReason: null,
    archiveDueAt: null,
    engagement: null,
    legacyPipelineStage: "",
    hasAppStage: true,
    lastActivity: null,
    ...over,
  };
}

const proposal: DraftProposal = {
  status: "ready",
  why: "A first email that names their Cursor video.",
  rules: ["one-ask", "specific-moment"],
  findings: [],
  gates: [],
  situation: null,
  model: null,
};

type Row = Omit<StoredDraft, "checked">;

function row(id: string, over: Partial<Row> = {}): Row {
  const subject = over.subject ?? "Your Cursor vs Copilot video";
  const body = over.body ?? "Hi Kai, the part where you timed both on one refactor was great.";
  return {
    id,
    creator: kai,
    kind: "first",
    followUp: null,
    state: "ready",
    subject,
    body,
    mailbox: "sara@gratovo.ai",
    sendAt: null,
    proposal,
    gatesOk: [],
    edited: false,
    rewriting: null,
    replyTo: null,
    problem: null,
    createdAt: start - 60_000,
    updatedAt: start - 60_000,
    approvedBy: null,
    checkedHash: textHash(subject, body),
    steer: null,
    ...over,
  };
}

interface Commit {
  at: number;
  drafts?: readonly { id: string; patch: DraftPatch }[];
  messages?: readonly NewMessage[];
  sequences?: readonly Sequence[];
  writes?: readonly DataWrite[];
}

/**
 * A data source with Reach's rows in memory. `write` applies `draft.state` and `draft.text` as
 * `sqlite-source.ts` does (D5): approving records who, and a draft that is sending or sent
 * ignores a person's change.
 */
function fakeSource(clock: () => number) {
  const drafts = new Map<string, Row>();
  const messages: NewMessage[] = [];
  const commits: Commit[] = [];
  const patches: DraftPatch[] = [];
  const sequences = new Map<string, Sequence>();
  const applied: DataWrite[] = [];
  let creators: CreatorState[] = [creator(kai), creator(lab)];

  const read = (r: Row): StoredDraft => ({
    ...r,
    checked: !r.edited || r.checkedHash === textHash(r.subject, r.body),
  });

  function patch(id: string, p: DraftPatch, at: number): boolean {
    const r = drafts.get(id);
    if (r === undefined) {
      return false;
    }
    patches.push(p);
    drafts.set(id, { ...r, ...p, updatedAt: at });
    return true;
  }

  function applyWrite(w: DataWrite): void {
    applied.push(w);
    if (w.kind === "creator.stage") {
      creators = creators.map((c) => (c.id === w.id ? { ...c, stage: w.stage } : c));
    }
  }

  const outreach: OutreachStore = {
    reachParts: () => ({ drafts: [], sequences: [], threads: [] }),
    draft: (id) => {
      const r = drafts.get(id);
      return r === undefined ? null : read(r);
    },
    draftsIn: (states) =>
      [...drafts.values()]
        .filter((r) => states.includes(r.state))
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(read),
    openDraft: () => null,
    insertDraft: (d) => {
      drafts.set(
        d.id,
        row(d.id, {
          creator: d.creator,
          kind: d.kind,
          followUp: d.followUp,
          mailbox: d.mailbox,
          replyTo: d.replyTo,
          state: "drafting",
          subject: "",
          body: "",
          proposal: null,
          checkedHash: null,
          createdAt: d.at,
          updatedAt: d.at,
        }),
      );
    },
    updateDraft: patch,
    thread: () => [],
    hasOutbound: () => false,
    recentOutbound: () => [],
    sentSince: () => [],
    mailboxCounts: () => new Map(),
    sequence: (id) => sequences.get(id) ?? null,
    runningSequences: () => [...sequences.values()].filter((q) => q.stopped === null),
    commit(change) {
      commits.push(change);
      for (const q of change.sequences ?? []) {
        sequences.set(q.creator, q);
      }
      for (const d of change.drafts ?? []) {
        patch(d.id, d.patch, change.at);
      }
      for (const m of change.messages ?? []) {
        if (
          m.gmailMessageId === null ||
          !messages.some((o) => o.gmailMessageId === m.gmailMessageId)
        ) {
          messages.push(m);
        }
      }
      for (const w of change.writes ?? []) {
        applyWrite(w);
      }
    },
  };

  const source = {
    outreach,
    creatorStates: () => Promise.resolve(creators),
    write(writes: readonly DataWrite[]) {
      for (const w of writes) {
        const r = w.kind.startsWith("draft.") ? drafts.get((w as { id: string }).id) : undefined;
        if (r !== undefined && (r.state === "sending" || r.state === "sent")) {
          continue;
        }
        if (w.kind === "draft.state" && r !== undefined) {
          const approving = w.state === "approved" || w.state === "scheduled";
          drafts.set(w.id, {
            ...r,
            state: w.state,
            sendAt: w.sendAt,
            approvedBy: approving ? me : r.approvedBy,
            updatedAt: clock(),
          });
        } else if (w.kind === "draft.text" && r !== undefined) {
          drafts.set(w.id, {
            ...r,
            subject: w.subject,
            body: w.body,
            edited: true,
            updatedAt: clock(),
          });
        } else {
          applyWrite(w);
        }
      }
      return Promise.resolve();
    },
  };

  return {
    source: source as unknown as DataSource,
    drafts,
    messages,
    commits,
    patches,
    sequences,
    applied,
    put(r: Row) {
      drafts.set(r.id, r);
    },
    setCreator(id: string, over: Partial<CreatorState>) {
      creators = creators.map((c) => (c.id === id ? { ...c, ...over } : c));
    },
    creator: (id: string) => creators.find((c) => c.id === id),
    state: (id: string) => drafts.get(id)?.state,
    problem: (id: string) => drafts.get(id)?.problem,
  };
}

function mailbox(address: string, over: Partial<MailboxView> = {}): MailboxView {
  return {
    address,
    connected: true,
    signedOut: false,
    dailyCap: 30,
    effectiveCap: 30,
    sentToday: 0,
    leftToday: 30,
    warmup: null,
    paused: false,
    status: "good",
    bounceRate: null,
    replyRate: null,
    checkedAt: null,
    ...over,
  };
}

const sentResult = (m: SendMessage, over: { duplicate?: boolean } = {}): SendOutcome => ({
  ok: true,
  replies: [],
  exit: {
    kind: "ended",
    end: { type: "end", state: "done", at: 0, found: 0, kept: 0 },
    result: {
      type: "result",
      kind: "mail.send",
      data: {
        duplicate: over.duplicate ?? false,
        account: m.mailbox ?? "sara@gratovo.ai",
        conversationKey: m.conversationKey ?? "c:x",
        messageId: "18c2f0a1b2c3d4e5",
        threadId: "18c2f0a1b2c3d4e0",
        rfcMessageId: null,
        labelled: true,
        threaded: false,
        to: m.to,
        subject: m.subject,
        sentAt: new Date(start + 11_000).toISOString(),
      },
    },
  },
});

const ended = (code: EndErrorCode, message = "It stopped."): SendOutcome => ({
  ok: true,
  replies: [],
  exit: {
    kind: "ended",
    end: { type: "end", state: "failed", at: 0, found: 0, kept: 0, error: { code, message } },
    result: null,
  },
});

const maybeGone =
  "Gmail didn't confirm the send, so the message may have gone out. Check the Sent folder before sending it again.";

// --- the harness ---

describe("the sender", () => {
  let clock: number;
  let timers: { id: number; at: number; run: () => void }[];
  let nextTimer: number;
  let mode: "example" | "live" | null;
  let fake: ReturnType<typeof fakeSource>;
  let boxes: MailboxView[];
  let send: ReturnType<typeof vi.fn<(m: SendMessage) => Promise<SendOutcome>>>;
  let check: ReturnType<
    typeof vi.fn<(id: string, subject: string, body: string) => Promise<CheckOutcome>>
  >;
  let afterSend: ReturnType<typeof vi.fn<() => void>>;
  let changed: ReturnType<typeof vi.fn<() => void>>;
  let lines: string[];
  let ids: number;
  let sender: Sender;

  /** Moves the clock on, running each timer that comes due and waiting for its send. */
  async function advance(ms: number): Promise<void> {
    const until = clock + ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) {
        break;
      }
      timers = timers.filter((t) => t !== due);
      clock = Math.max(clock, due.at);
      due.run();
      await sender.idle();
    }
    clock = until;
  }

  /** A person presses Send: the write the page makes, then main's `afterWrite`. */
  async function approve(id: string): Promise<void> {
    await fake.source.write([
      { kind: "draft.state", id, state: "approved", sendAt: clock + holdMs },
    ]);
    sender.afterWrite();
  }

  beforeEach(() => {
    clock = start;
    timers = [];
    nextTimer = 1;
    mode = "live";
    fake = fakeSource(() => clock);
    boxes = [mailbox("sara@gratovo.ai"), mailbox("omar@gratovo.ai")];
    send = vi.fn((m: SendMessage) => Promise.resolve(sentResult(m)));
    check = vi.fn(() => Promise.resolve<CheckOutcome>({ ok: true, blocking: false, findings: [] }));
    afterSend = vi.fn();
    changed = vi.fn();
    lines = [];
    ids = 0;
    sender = createSender({
      mode: () => mode,
      source: () => fake.source,
      me: () => me,
      send,
      check,
      mailboxes: () => boxes,
      afterSend,
      changed,
      now: () => clock,
      setTimer: (run, ms) => {
        const id = nextTimer++;
        timers.push({ id, at: clock + ms, run });
        return id;
      },
      clearTimer: (handle) => {
        timers = timers.filter((t) => t.id !== handle);
      },
      newId: () => `id-${String(++ids)}`,
      log: (line) => lines.push(line),
    });
    // As the app does when a source opens (with nothing left from an earlier run here).
    sender.start();
  });

  afterEach(() => {
    // Whatever a test did, the sender itself never approves or schedules a draft.
    for (const p of fake.patches) {
      expect(p.state === "approved" || p.state === "scheduled").toBe(false);
    }
    // And no log line carries an address, a subject or a body.
    for (const line of lines) {
      expect(line).not.toMatch(/@|Cursor|Hi Kai/);
    }
  });

  describe("an approved draft", () => {
    it("waits out the 10 s hold, then sends exactly once", async () => {
      fake.put(row("d1"));
      await approve("d1");
      await advance(holdMs - 1);
      expect(send).not.toHaveBeenCalled();
      await advance(1);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0]?.[0]).toEqual({
        to: "kai@codewithkai.com",
        subject: "Your Cursor vs Copilot video",
        body: "Hi Kai, the part where you timed both on one refactor was great.",
        mailbox: "sara@gratovo.ai",
        conversationKey: `c:${kai}`,
        channelId: kai,
        sendKey: "draft-d1",
        approvedBy: me,
      });
      await advance(60_000);
      expect(send).toHaveBeenCalledTimes(1);
    });

    it("records the send in one commit: the message, the draft sent, the stage and its line", async () => {
      fake.put(row("d1"));
      await approve("d1");
      await advance(holdMs);
      expect(fake.state("d1")).toBe("sent");
      const last = fake.commits.at(-1);
      expect(last?.drafts).toEqual([{ id: "d1", patch: { state: "sent", problem: null } }]);
      expect(last?.messages).toEqual([
        {
          id: "id-1",
          creator: kai,
          direction: "out",
          kind: "first",
          followUp: null,
          subject: "Your Cursor vs Copilot video",
          body: "Hi Kai, the part where you timed both on one refactor was great.",
          bodyCut: false,
          at: start + 11_000,
          mailbox: "sara@gratovo.ai",
          peer: "kai@codewithkai.com",
          peerName: "Kai",
          conversationKey: `c:${kai}`,
          gmailMessageId: "18c2f0a1b2c3d4e5",
          gmailThreadId: "18c2f0a1b2c3d4e0",
          draftId: "d1",
          by: me,
          source: "app",
          reading: null,
        },
      ]);
      expect(last?.writes).toEqual([
        {
          kind: "creator.stage",
          id: kai,
          stage: "emailed",
          handle: "@codewithkai",
          name: "Code with Kai",
        },
        {
          kind: "log.add",
          id: "id-2",
          at: start + 11_000,
          text: senderStrings.firstSent("Code with Kai"),
          ref: kai,
          action: null,
          detail: null,
        },
      ]);
      expect(fake.creator(kai)?.stage).toBe("emailed");
      expect(afterSend).toHaveBeenCalledTimes(1);
      expect(changed).toHaveBeenCalled();
    });

    it("starts the sequence in the same commit as a first email, from the mailbox it went from", async () => {
      fake.put(row("d1"));
      await approve("d1");
      await advance(holdMs);
      const last = fake.commits.at(-1);
      expect(last?.messages).toHaveLength(1);
      const sentAt = start + 11_000;
      expect(last?.sequences).toEqual([
        {
          creator: kai,
          mailbox: "sara@gratovo.ai",
          startedAt: sentAt,
          steps: planSteps(sentAt),
          stopped: null,
          parkUntil: null,
        },
      ]);
    });

    it("keeps a sequence that exists, and marks a sent follow-up's step sent in its commit", async () => {
      const have: Sequence = {
        creator: kai,
        mailbox: "omar@gratovo.ai",
        startedAt: start - 4 * 86_400_000,
        steps: [
          { n: 1, dueAt: start - 86_400_000, state: "drafted", sentAt: null },
          { n: 2, dueAt: start + 3 * 86_400_000, state: "planned", sentAt: null },
        ],
        stopped: null,
        parkUntil: null,
      };
      fake.sequences.set(kai, have);
      fake.put(row("d1")); // a first email: no second sequence
      fake.put(row("f1", { kind: "followUp", followUp: 1 }));
      await approve("f1");
      await advance(holdMs);
      const sent = fake.commits.find((c) => c.messages?.[0]?.kind === "followUp");
      expect(sent?.messages?.[0]?.conversationKey).toBe(`c:${kai}`);
      expect(sent?.sequences?.[0]?.mailbox).toBe("omar@gratovo.ai");
      expect(sent?.sequences?.[0]?.steps.map((x) => [x.n, x.state, x.sentAt])).toEqual([
        [1, "sent", start + 11_000],
        [2, "planned", null],
      ]);
      await approve("d1");
      await advance(holdMs);
      expect(fake.sequences.get(kai)?.mailbox).toBe("omar@gratovo.ai");
    });

    it("moves no stage for a follow-up, or for a creator past contact", async () => {
      fake.put(row("f1", { kind: "followUp", followUp: 1 }));
      fake.put(row("d2", { creator: lab }));
      fake.setCreator(lab, { stage: "replied" });
      await approve("f1");
      await approve("d2");
      await advance(holdMs);
      expect(send).toHaveBeenCalledTimes(2);
      for (const c of fake.commits.filter((c) => c.messages !== undefined)) {
        expect(c.writes).toEqual([]);
      }
      expect(fake.creator(kai)?.stage).toBe("contact");
    });

    it("is not sent when Undo puts it back to ready within the hold", async () => {
      fake.put(row("d1"));
      await approve("d1");
      await advance(4000);
      await fake.source.write([{ kind: "draft.state", id: "d1", state: "ready", sendAt: null }]);
      sender.afterWrite();
      await advance(60_000);
      expect(send).not.toHaveBeenCalled();
      expect(fake.state("d1")).toBe("ready");
    });

    it("is not sent after an Undo even when main missed the write", async () => {
      fake.put(row("d1"));
      await approve("d1");
      await fake.source.write([{ kind: "draft.state", id: "d1", state: "ready", sendAt: null }]);
      await advance(60_000);
      expect(send).not.toHaveBeenCalled();
    });

    it("sends the text a person edited during the hold, after checking it", async () => {
      fake.put(row("d1"));
      await approve("d1");
      await fake.source.write([
        { kind: "draft.text", id: "d1", subject: "Your Cursor video", body: "Hi Kai, quick one." },
      ]);
      sender.afterWrite();
      await advance(holdMs);
      expect(check).toHaveBeenCalledWith("d1", "Your Cursor video", "Hi Kai, quick one.");
      expect(send.mock.calls[0]?.[0]).toMatchObject({
        subject: "Your Cursor video",
        body: "Hi Kai, quick one.",
      });
    });

    it("sends one at a time", async () => {
      fake.put(row("d1"));
      fake.put(row("d2", { creator: lab }));
      let release!: () => void;
      send.mockImplementationOnce(
        (m) =>
          new Promise((resolve) => {
            release = () => {
              resolve(sentResult(m));
            };
          }),
      );
      await approve("d1");
      await approve("d2");
      clock += holdMs;
      for (const t of timers.splice(0)) {
        t.run();
      }
      await vi.waitFor(() => {
        expect(send).toHaveBeenCalledTimes(1);
      });
      expect(fake.state("d2")).toBe("approved");
      release();
      await sender.idle();
      await advance(0);
      expect(send).toHaveBeenCalledTimes(2);
      expect(fake.state("d1")).toBe("sent");
      expect(fake.state("d2")).toBe("sent");
    });
  });

  describe("before start", () => {
    it("fires nothing until start() has settled what an earlier run left approved", async () => {
      sender.drop();
      // The app closed mid-hold: the row is still approved, its time long past.
      fake.put(row("left", { state: "approved", sendAt: start - 60_000, approvedBy: me }));
      // A write comes in while the mailboxes are still being read (opened() awaits a status).
      sender.afterWrite();
      await advance(holdMs * 3);
      expect(send).not.toHaveBeenCalled();
      sender.start();
      await advance(holdMs * 3);
      expect(send).not.toHaveBeenCalled();
      expect(fake.source.outreach.draft("left")).toMatchObject({
        state: "ready",
        problem: "not_sent_closed",
      });
    });
  });

  describe("the person's approval", () => {
    it("is the only way a mail.send reaches send", async () => {
      // Every state main or the drafter can leave a row in, and an approved row with no approver.
      fake.put(row("drafting", { state: "drafting", proposal: null }));
      fake.put(row("ready", { state: "ready" }));
      fake.put(row("failed", { state: "failed", problem: "send_failed" }));
      fake.put(row("skipped", { state: "skipped" }));
      fake.put(row("sent", { state: "sent" }));
      fake.put(row("rogue", { state: "approved", sendAt: start + holdMs, approvedBy: null }));
      sender.start();
      sender.afterWrite();
      await advance(24 * 3_600_000);
      expect(send).not.toHaveBeenCalled();
      // Only now: a person's write.
      await approve("ready");
      await advance(holdMs);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0]?.[0].sendKey).toBe("draft-ready");
    });

    it("never sends a draft that reached approved without an approver: it goes back to ready", async () => {
      fake.put(row("d1", { state: "approved", sendAt: start + holdMs, approvedBy: null }));
      sender.afterWrite();
      await advance(holdMs);
      expect(send).not.toHaveBeenCalled();
      expect(fake.state("d1")).toBe("ready");
      expect(lines.some((l) => l.includes("no approver"))).toBe(true);
    });
  });

  describe("the gates at send time", () => {
    it("send it back to ready when the address is no longer confirmed", async () => {
      fake.put(row("d1"));
      await approve("d1");
      fake.setCreator(kai, { emailConfirmed: false });
      await advance(holdMs);
      expect(send).not.toHaveBeenCalled();
      expect(fake.drafts.get("d1")).toMatchObject({ state: "ready", problem: "gates_changed" });
      expect(changed).toHaveBeenCalled();
    });

    it("say which mailbox gate held it", async () => {
      fake.put(row("d1"));
      fake.put(row("d2", { creator: lab, mailbox: "omar@gratovo.ai" }));
      await approve("d1");
      await approve("d2");
      boxes = [
        mailbox("sara@gratovo.ai", { leftToday: 0 }),
        mailbox("omar@gratovo.ai", { signedOut: true, status: "signed_out" }),
      ];
      await advance(holdMs);
      expect(send).not.toHaveBeenCalled();
      expect(fake.problem("d1")).toBe("mailbox_full");
      expect(fake.problem("d2")).toBe("mailbox_signed_out");
    });

    it("hold a draft whose engine gate is not confirmed, and a creator now never contact", async () => {
      fake.put(
        row("d1", {
          proposal: {
            ...proposal,
            gates: [{ key: "g1", kind: "price", text: "It names a price." }],
          },
        }),
      );
      fake.put(row("d2", { creator: lab }));
      fake.setCreator(lab, { stage: "never" });
      await approve("d1");
      await approve("d2");
      await advance(holdMs);
      expect(send).not.toHaveBeenCalled();
      expect(fake.problem("d1")).toBe("gates_changed");
      expect(fake.problem("d2")).toBe("gates_changed");
    });
  });

  describe("an edited text", () => {
    const edited = { edited: true, body: "Hi Kai, edited.", checkedHash: null };

    it("is checked first; a blocking finding sends it back with the finding", async () => {
      const finding = { rule: "no-flattery", text: "It flatters.", blocking: true };
      check.mockResolvedValueOnce({ ok: true, blocking: true, findings: [finding] });
      fake.put(row("d1", edited));
      await approve("d1");
      await advance(holdMs);
      expect(send).not.toHaveBeenCalled();
      const d = fake.drafts.get("d1");
      expect(d).toMatchObject({ state: "ready", problem: "gates_changed" });
      expect(d?.proposal?.findings).toEqual([finding]);
      expect(d?.checkedHash).toBe(textHash(d?.subject ?? "", d?.body ?? ""));
    });

    it("goes when the check passes", async () => {
      fake.put(row("d1", edited));
      await approve("d1");
      await advance(holdMs);
      expect(check).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledTimes(1);
      expect(fake.state("d1")).toBe("sent");
    });

    it("holds a text the checks had blocked until a check passes: no check, no send", async () => {
      const blockedRow = (id: string) =>
        row(id, {
          ...edited,
          proposal: { ...proposal, status: "blocked" },
        });
      check.mockResolvedValueOnce({ ok: false });
      fake.put(blockedRow("d1"));
      await approve("d1");
      await advance(holdMs);
      expect(send).not.toHaveBeenCalled();
      expect(fake.drafts.get("d1")).toMatchObject({ state: "ready", problem: "needs_check" });

      // A check that passes lifts the engine's "blocked" and it goes.
      fake.put(blockedRow("d2"));
      await approve("d2");
      await advance(holdMs);
      expect(send).toHaveBeenCalledTimes(1);
      expect(fake.state("d2")).toBe("sent");
    });

    it("goes with the bridge off, and the log line says it wasn't checked again", async () => {
      check.mockResolvedValueOnce({ ok: false });
      fake.put(row("d1", edited));
      await approve("d1");
      await advance(holdMs);
      expect(send).toHaveBeenCalledTimes(1);
      const line = fake.applied.find((w) => w.kind === "log.add");
      expect(line).toMatchObject({ text: senderStrings.firstSentUnchecked("Code with Kai") });
      expect(lines.some((l) => l.includes("not checked again"))).toBe(true);
    });

    it("is not checked when the text was checked already", async () => {
      fake.put(row("d1", { edited: true }));
      await approve("d1");
      await advance(holdMs);
      expect(check).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  describe("a failed send", () => {
    const cases: [string, SendOutcome | "throw", "ready" | "failed", string][] = [
      ["daily_cap_reached", ended("daily_cap_reached"), "ready", "mailbox_full"],
      ["mail_auth", ended("mail_auth"), "ready", "mailbox_signed_out"],
      ["send_uncertain", ended("send_uncertain"), "failed", "maybe_sent"],
      ["network that may have gone", ended("network", maybeGone), "failed", "maybe_sent"],
      [
        "network that never went",
        ended(
          "network",
          "Couldn't reach Gmail, so nothing was sent. Try again once the connection is back.",
        ),
        "failed",
        "send_failed",
      ],
      ["mail_api that may have gone", ended("mail_api", maybeGone), "failed", "maybe_sent"],
      [
        "mail_api refused",
        ended("mail_api", "Gmail refused the message (400)."),
        "failed",
        "send_failed",
      ],
      ["bad_start", ended("bad_start"), "failed", "send_failed"],
      ["mail_not_connected", ended("mail_not_connected"), "failed", "send_failed"],
      ["a crash code", ended("crash"), "failed", "maybe_sent"],
      [
        "a crash",
        { ok: true, replies: [], exit: { kind: "failed", reason: "crash" } },
        "failed",
        "maybe_sent",
      ],
      [
        "a kill",
        { ok: true, replies: [], exit: { kind: "failed", reason: "killed" } },
        "failed",
        "maybe_sent",
      ],
      [
        "a protocol failure",
        { ok: true, replies: [], exit: { kind: "failed", reason: "protocol" } },
        "failed",
        "maybe_sent",
      ],
      [
        "a process that never started",
        { ok: true, replies: [], exit: { kind: "failed", reason: "spawn" } },
        "failed",
        "send_failed",
      ],
      ["no Python", { ok: false, problem: "no_python" }, "failed", "send_failed"],
      ["no start", { ok: false, problem: "not_started" }, "failed", "send_failed"],
      ["a call that threw", "throw", "failed", "maybe_sent"],
      [
        "done with no answer",
        {
          ok: true,
          replies: [],
          exit: {
            kind: "ended",
            end: { type: "end", state: "done", at: 0, found: 0, kept: 0 },
            result: null,
          },
        },
        "failed",
        "maybe_sent",
      ],
    ];

    it.each(
      cases.map(([name, outcome, state, problem]) => [name, state, problem, outcome] as const),
    )("%s leaves it %s with %s, and is never tried again", async (_, state, problem, outcome) => {
      send.mockImplementation(() =>
        outcome === "throw" ? Promise.reject(new Error("x")) : Promise.resolve(outcome),
      );
      fake.put(row("d1"));
      await approve("d1");
      await advance(holdMs);
      expect(fake.drafts.get("d1")).toMatchObject({ state, problem });
      expect(fake.messages).toEqual([]);
      expect(fake.creator(kai)?.stage).toBe("contact");
      sender.afterWrite();
      sender.start();
      await advance(24 * 3_600_000);
      expect(send).toHaveBeenCalledTimes(1);
    });

    it("records a duplicate as sent: it had gone", async () => {
      send.mockImplementation((m) => Promise.resolve(sentResult(m, { duplicate: true })));
      fake.put(row("d1"));
      await approve("d1");
      await advance(holdMs);
      expect(fake.state("d1")).toBe("sent");
      expect(fake.messages).toHaveLength(1);
      expect(fake.creator(kai)?.stage).toBe("emailed");
    });

    it("reads a mail.send verdict without a job", () => {
      expect(sendVerdict(null)).toMatchObject({ kind: "failed", problem: "maybe_sent" });
    });
  });

  describe("start", () => {
    it("settles what an earlier run left", async () => {
      fake.put(row("a", { state: "approved", sendAt: start - 5000, approvedBy: me }));
      fake.put(row("s", { state: "sending", approvedBy: me }));
      fake.put(row("late", { state: "scheduled", sendAt: start - lateMs - 1, approvedBy: me }));
      fake.put(
        row("soon", { creator: lab, state: "scheduled", sendAt: start - 60_000, approvedBy: me }),
      );
      fake.put(
        row("later", {
          creator: lab,
          state: "scheduled",
          sendAt: start + 3_600_000,
          approvedBy: me,
        }),
      );
      sender.start();
      expect(fake.drafts.get("a")).toMatchObject({ state: "ready", problem: "not_sent_closed" });
      expect(fake.drafts.get("s")).toMatchObject({ state: "failed", problem: "maybe_sent" });
      expect(fake.drafts.get("late")).toMatchObject({ state: "ready", problem: "late" });
      expect(changed).toHaveBeenCalled();
      // A scheduled draft a little late goes now; one ahead goes at its time.
      await advance(0);
      expect(send.mock.calls.map((c) => c[0].sendKey)).toEqual(["draft-soon"]);
      await advance(3_600_000);
      expect(send.mock.calls.map((c) => c[0].sendKey)).toEqual(["draft-soon", "draft-later"]);
    });

    it("sends a Send later back to the person when the computer slept far past its time", async () => {
      fake.put(row("s", { state: "scheduled", sendAt: start + 60_000, approvedBy: me }));
      fake.put(
        row("t", { creator: lab, state: "scheduled", sendAt: start + 120_000, approvedBy: me }),
      );
      sender.start();
      // The app stays open while the computer sleeps for three days: the clock jumps, then the
      // timer fires once on wake.
      clock = start + 3 * 86_400_000;
      await advance(0);
      expect(send).not.toHaveBeenCalled();
      expect(fake.drafts.get("s")).toMatchObject({ state: "ready", problem: "late" });
      expect(fake.drafts.get("t")).toMatchObject({ state: "ready", problem: "late" });
      expect(changed).toHaveBeenCalled();
    });

    it("arms a timer only for approved and scheduled drafts, and drop clears it", () => {
      fake.put(
        row("later", { state: "scheduled", sendAt: start + 5 * 86_400_000, approvedBy: me }),
      );
      sender.start();
      expect(timers).toHaveLength(1);
      // A far-off schedule re-arms within the hour rather than overflow the timer.
      expect(timers[0]?.at).toBe(start + 3_600_000);
      sender.drop();
      expect(timers).toHaveLength(0);
    });
  });

  describe("a draft that may have gone", () => {
    beforeEach(() => {
      fake.put(row("m", { state: "failed", problem: "maybe_sent", approvedBy: "u2" }));
      fake.put(row("f", { creator: lab, state: "failed", problem: "send_failed", approvedBy: me }));
    });

    it("is recorded as sent with no job when a person says it went", async () => {
      await expect(sender.markSent("m")).resolves.toEqual({ ok: true });
      expect(send).not.toHaveBeenCalled();
      expect(fake.state("m")).toBe("sent");
      expect(fake.messages).toEqual([
        expect.objectContaining({
          draftId: "m",
          gmailMessageId: null,
          gmailThreadId: null,
          by: "u2",
          mailbox: "sara@gratovo.ai",
          peer: "kai@codewithkai.com",
          conversationKey: `c:${kai}`,
        }),
      ]);
      expect(fake.creator(kai)?.stage).toBe("emailed");
      expect(afterSend).toHaveBeenCalledTimes(1);
    });

    it("is copied to a new ready draft for Send as new, the old one skipped", async () => {
      await expect(sender.sendNew("m")).resolves.toEqual({ ok: true });
      expect(fake.state("m")).toBe("skipped");
      const copy = fake.drafts.get("id-1");
      expect(copy).toMatchObject({
        state: "ready",
        creator: kai,
        kind: "first",
        mailbox: "sara@gratovo.ai",
        subject: "Your Cursor vs Copilot video",
        approvedBy: null,
      });
      await advance(60_000);
      expect(send).not.toHaveBeenCalled();
    });

    it("refuses any other draft", async () => {
      await expect(sender.markSent("f")).resolves.toEqual({ ok: false, problem: "wrong_state" });
      await expect(sender.sendNew("f")).resolves.toEqual({ ok: false, problem: "wrong_state" });
      await expect(sender.markSent("nope")).resolves.toEqual({ ok: false, problem: "not_found" });
      await expect(sender.sendNew("nope")).resolves.toEqual({ ok: false, problem: "not_found" });
      expect(fake.messages).toEqual([]);
    });

    it("records it once when It was sent is pressed twice", async () => {
      const both = await Promise.all([sender.markSent("m"), sender.markSent("m")]);
      expect(both).toEqual([{ ok: true }, { ok: false, problem: "wrong_state" }]);
      expect(fake.messages).toHaveLength(1);
    });
  });

  describe("on the example data", () => {
    it("records the send at the time with no job and no check", async () => {
      mode = "example";
      fake.put(row("d1", { edited: true, checkedHash: null }));
      await approve("d1");
      await advance(holdMs);
      expect(send).not.toHaveBeenCalled();
      expect(check).not.toHaveBeenCalled();
      expect(fake.state("d1")).toBe("sent");
      expect(fake.messages[0]).toMatchObject({ gmailMessageId: null, gmailThreadId: null, by: me });
      expect(fake.creator(kai)?.stage).toBe("emailed");
      expect(afterSend).toHaveBeenCalledTimes(1);
    });
  });

  it("does nothing with no data open", async () => {
    mode = null;
    fake.put(row("d1", { state: "approved", sendAt: start, approvedBy: me }));
    sender.start();
    sender.afterWrite();
    await advance(holdMs);
    expect(timers).toHaveLength(0);
    expect(fake.state("d1")).toBe("approved");
  });
});

describe("the sender on a real source", () => {
  let dir: string;
  let clock: number;
  let source: DataSource;
  let timers: { at: number; run: () => void }[];
  let send: ReturnType<typeof vi.fn<(m: SendMessage) => Promise<SendOutcome>>>;
  let sender: Sender;

  async function advance(ms: number): Promise<void> {
    const until = clock + ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) {
        break;
      }
      timers = timers.filter((t) => t !== due);
      clock = Math.max(clock, due.at);
      due.run();
      await sender.idle();
    }
    clock = until;
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "gratovo-sender-"));
    clock = start;
    source = openLiveSource(join(dir, "gratovo.db"), me, () => clock);
    const who = { handle: "@codewithkai", name: "Code with Kai" };
    await source.write([
      { kind: "creator.stage", id: kai, stage: "contact", ...who },
      {
        kind: "creator.contact",
        id: kai,
        email: "kai@codewithkai.com",
        confirmed: true,
        contactName: "Kai",
        source: "about",
        confidence: 0.9,
        ...who,
      },
    ]);
    // What the drafter leaves: a ready draft. Every state but approved and scheduled is here.
    const states = ["drafting", "ready", "failed", "skipped"] as const;
    for (const state of states) {
      source.outreach.insertDraft({
        id: state,
        creator: kai,
        kind: "first",
        followUp: null,
        mailbox: "sara@gratovo.ai",
        replyTo: null,
        at: start - 60_000,
      });
      source.outreach.updateDraft(
        state,
        {
          state,
          subject: "Your Cursor vs Copilot video",
          body: "Hi Kai, the part where you timed both on one refactor was great.",
          proposal,
          checkedHash: textHash(
            "Your Cursor vs Copilot video",
            "Hi Kai, the part where you timed both on one refactor was great.",
          ),
        },
        start - 60_000,
      );
    }
    timers = [];
    send = vi.fn((m: SendMessage) => Promise.resolve(sentResult(m)));
    sender = createSender({
      mode: () => "live",
      source: () => source,
      me: () => me,
      send,
      check: () => Promise.resolve({ ok: false }),
      mailboxes: () => [mailbox("sara@gratovo.ai")],
      afterSend: () => undefined,
      changed: () => undefined,
      now: () => clock,
      setTimer: (run, ms) => {
        const t = { at: clock + ms, run };
        timers.push(t);
        return t;
      },
      clearTimer: (handle) => {
        timers = timers.filter((t) => t !== handle);
      },
      log: () => undefined,
    });
  });

  afterEach(() => {
    source.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("sends only after a person's write approves a draft, once, and records it", async () => {
    sender.start();
    sender.afterWrite();
    await advance(24 * 3_600_000);
    expect(send).not.toHaveBeenCalled();

    await source.write([
      { kind: "draft.state", id: "ready", state: "approved", sendAt: clock + holdMs },
    ]);
    sender.afterWrite();
    expect(source.outreach.draft("ready")?.approvedBy).toBe(me);
    await advance(holdMs - 1);
    expect(send).not.toHaveBeenCalled();
    await advance(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({ sendKey: "draft-ready", approvedBy: me });
    expect(source.outreach.draft("ready")?.state).toBe("sent");
    expect(source.outreach.thread(kai, 10)).toEqual([
      expect.objectContaining({ direction: "out", kind: "first", by: me, source: "app" }),
    ]);
    expect((await source.creatorStates()).find((c) => c.id === kai)?.stage).toBe("emailed");
    expect(source.outreach.sentSince(start)).toEqual([{ mailbox: "sara@gratovo.ai", count: 1 }]);

    // The Undo after the hold is ignored by the source, and nothing goes twice.
    await source.write([{ kind: "draft.state", id: "ready", state: "ready", sendAt: null }]);
    sender.afterWrite();
    await advance(60_000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when Undo comes within the hold", async () => {
    await source.write([
      { kind: "draft.state", id: "ready", state: "approved", sendAt: clock + holdMs },
    ]);
    sender.afterWrite();
    await advance(5000);
    await source.write([{ kind: "draft.state", id: "ready", state: "ready", sendAt: null }]);
    sender.afterWrite();
    await advance(60_000);
    expect(send).not.toHaveBeenCalled();
    expect(source.outreach.draft("ready")).toMatchObject({ state: "ready", approvedBy: null });
  });
});
