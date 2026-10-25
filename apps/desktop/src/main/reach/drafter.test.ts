import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  CreatorState,
  DataSource,
  DraftPatch,
  DraftState,
  MailboxView,
  NewDraft,
  OutreachStore,
  Sequence,
  StoredDraft,
  ThreadMessage,
} from "@gratovo/core/data";
import { draftProposalSchema, outreachDraftSchema } from "@gratovo/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openLiveSource } from "../data/live-source";
import { upsertCreator } from "../data/repositories";
import { openDatabase } from "../db/open-database";
import { channelId, creatorState } from "../find/catalog-fixture";
import type { GeminiParams, GeminiResult } from "../pipeline/gemini-protocol";
import type { GeminiCall } from "../pipeline/gemini-service";

import {
  createDrafter,
  kickDelayMs,
  mapProposal,
  standInMs,
  standInRewrite,
  type Drafter,
  type DrafterSource,
} from "./drafter";
import { reachStrings } from "./strings";

type Params = GeminiParams<"action.comms_propose">;
type Call = GeminiCall<"action.comms_propose">;
type Result = GeminiResult<"action.comms_propose">;

const start = Date.UTC(2026, 9, 25, 9, 0);

/** The outreach tables as an in-memory store: the drafter's reads and writes, nothing more. */
class FakeOutreach implements OutreachStore {
  readonly drafts = new Map<string, StoredDraft>();
  readonly messages: { creator: string; message: ThreadMessage }[] = [];
  readonly sequences = new Map<string, Sequence>();

  reachParts(): never {
    throw new Error("not the drafter's");
  }
  draft(id: string): StoredDraft | null {
    return this.drafts.get(id) ?? null;
  }
  draftsIn(states: readonly DraftState[]): StoredDraft[] {
    return [...this.drafts.values()]
      .filter((d) => states.includes(d.state))
      .sort((a, b) => a.createdAt - b.createdAt);
  }
  openDraft(creator: string): StoredDraft | null {
    const open = [...this.drafts.values()].filter(
      (d) => d.creator === creator && d.state !== "sent" && d.state !== "skipped",
    );
    return open.at(-1) ?? null;
  }
  insertDraft(d: NewDraft): void {
    this.drafts.set(d.id, {
      id: d.id,
      creator: d.creator,
      kind: d.kind,
      followUp: d.followUp,
      state: "drafting",
      subject: "",
      body: "",
      mailbox: d.mailbox,
      sendAt: null,
      proposal: null,
      gatesOk: [],
      edited: false,
      checked: false,
      rewriting: null,
      replyTo: d.replyTo,
      problem: null,
      createdAt: d.at,
      updatedAt: d.at,
      approvedBy: null,
      checkedHash: null,
      steer: null,
    });
  }
  updateDraft(id: string, patch: DraftPatch, at: number): boolean {
    const draft = this.drafts.get(id);
    if (draft === undefined) {
      return false;
    }
    this.drafts.set(id, { ...draft, ...patch, updatedAt: at });
    return true;
  }
  thread(creator: string, limit: number): ThreadMessage[] {
    return this.messages
      .filter((m) => m.creator === creator)
      .slice(-limit)
      .map((m) => m.message);
  }
  hasOutbound(creator: string): boolean {
    return this.messages.some((m) => m.creator === creator && m.message.direction === "out");
  }
  recentOutbound(limit: number): { creator: string; body: string }[] {
    return this.messages
      .filter((m) => m.message.direction === "out")
      .reverse()
      .slice(0, limit)
      .map((m) => ({ creator: m.creator, body: m.message.body }));
  }
  mailboxCounts(): ReturnType<OutreachStore["mailboxCounts"]> {
    return new Map();
  }
  sentSince(): { mailbox: string; count: number }[] {
    return [];
  }
  sequence(creator: string): Sequence | null {
    return this.sequences.get(creator) ?? null;
  }
  commit(change: Parameters<OutreachStore["commit"]>[0]): void {
    for (const { id, patch } of change.drafts ?? []) {
      this.updateDraft(id, patch, change.at);
    }
    for (const sequence of change.sequences ?? []) {
      this.sequences.set(sequence.creator, sequence);
    }
  }
}

const mailbox = (address: string, leftToday: number): MailboxView => ({
  address,
  connected: true,
  signedOut: false,
  dailyCap: 30,
  effectiveCap: 30,
  sentToday: 30 - leftToday,
  leftToday,
  warmup: null,
  paused: false,
  status: "good",
  bounceRate: null,
  replyRate: null,
  checkedAt: null,
});

const sam = channelId("promptlab");
const kai = channelId("codewithkai");
const tess = channelId("tensortalk");

const confirmed = (id: string, over: Partial<CreatorState> = {}): CreatorState =>
  creatorState(id, {
    stage: "contact",
    email: `${id.slice(2, 8).toLowerCase()}@creator.example`,
    emailConfirmed: true,
    ...over,
  });

const SAM_BODY =
  "Hi Sam,\n\nYour side-by-side test of Claude Code and Cursor on a real app was easy to follow.\n\nWould you be open to hearing about an AI code review tool that fits your audience?\n\nMoustafa";

/** An engine answer shaped as `actions.comms_propose` returns it (test_comms_actions.py). */
function engineResult(over: Partial<Result> = {}): Result {
  return {
    status: "needs_human",
    proposal: {
      situation: {
        side: "influencer",
        stage: "prospect",
        reply_type: null,
        summary: "A first email to an AI coding channel.",
      },
      decision: {
        action: "send_message",
        why: "Open on the Cursor test from their latest video, then ask one small question.",
        rules: ["INF-FIRST-02", "FND-WRITE-11", 7, ""],
      },
      message: { channel: "email", subject: "your claude code test", body: SAM_BODY },
      needs_human: [{ what: "fact_missing", detail: "confirm the contact's first name" }],
      follow_up: { in_working_days: 3, note: null },
      facts_used: [],
    },
    findings: [
      {
        code: "NEEDY",
        severity: "warn",
        rule: "INF-FIRST-07",
        detail: "the ask leans on what we want",
      },
      { code: "COURSE_CHECK_SKIPPED", severity: "warn", rule: "-", detail: "no course loaded" },
    ],
    gates: [
      { what: "fact_missing", detail: "confirm the contact's first name" },
      {
        what: "price",
        detail: "the message names a price, amount or percentage",
        source: "checks",
      },
      { what: "something_new", detail: "the model's own" },
    ],
    case: { side: "influencer", stage: "prospect", goal: "Open a conversation." },
    moments: [],
    momentsNote: null,
    seconds: 95,
    model: "Gemini 3 Pro",
    thinking: "High",
    ...over,
  };
}

const answered = (result: Result = engineResult()): Call => ({ ok: true, result });
const failed = (code: string, message = "", details: Record<string, unknown> = {}): Call =>
  ({ ok: false, error: { code, message, details } }) as Call;

interface Held {
  ms: number;
  release: () => void;
}

describe("the drafter", () => {
  let store: FakeOutreach;
  let states: CreatorState[];
  let mode: "example" | "live" | null;
  let bridge: { ready: boolean; pausedUntil: number | null };
  let sender: string | null;
  let mailboxes: MailboxView[];
  let propose: ReturnType<typeof vi.fn<(params: Params) => Promise<Call>>>;
  let changed: ReturnType<typeof vi.fn<() => void>>;
  let bridgeChecks: number;
  let clock: number;
  let held: Held[];
  let ids: number;
  let drafter: Drafter;

  const source = (): DrafterSource => ({
    creatorStates: () => Promise.resolve(states),
    outreach: store,
  });

  function make(options: { realTimers?: boolean } = {}): Drafter {
    return createDrafter({
      mode: () => mode,
      source: () => (mode === null ? null : source()),
      bridge: () => {
        bridgeChecks += 1;
        return Promise.resolve(bridge);
      },
      propose,
      sender: () => sender,
      mailboxes: () => mailboxes,
      changed,
      now: () => clock,
      newId: () => `d${String(++ids)}`,
      ...(options.realTimers
        ? {}
        : {
            // The debounce and the stand-ins pass at once; anything longer (a pause) waits for
            // the test to let it go.
            wait: (ms: number) =>
              ms <= kickDelayMs
                ? Promise.resolve()
                : new Promise<void>((resolve) => {
                    held.push({ ms, release: resolve });
                  }),
          }),
    });
  }

  const drafts = (): StoredDraft[] => [...store.drafts.values()];
  const only = (): StoredDraft => {
    const all = drafts();
    expect(all).toHaveLength(1);
    return all[0] as StoredDraft;
  };
  const kicked = async (): Promise<void> => {
    drafter.kick();
    await drafter.idle();
  };
  function seed(id: string, creator: string, over: Partial<StoredDraft> = {}): void {
    store.insertDraft({
      id,
      creator,
      kind: "first",
      followUp: null,
      mailbox: "moustafa@gratovo.example",
      replyTo: null,
      at: clock,
    });
    store.updateDraft(id, over, clock);
  }

  beforeEach(() => {
    store = new FakeOutreach();
    states = [];
    mode = "live";
    bridge = { ready: true, pausedUntil: null };
    sender = "Moustafa";
    mailboxes = [mailbox("lina@gratovo.example", 4), mailbox("moustafa@gratovo.example", 12)];
    propose = vi.fn<(params: Params) => Promise<Call>>(() => Promise.resolve(answered()));
    changed = vi.fn<() => void>();
    bridgeChecks = 0;
    clock = start;
    held = [];
    ids = 0;
    drafter = make();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("the kick", () => {
    it("drafts for exactly the creators at contact with a confirmed address and nothing sent", async () => {
      const unconfirmed = channelId("unconfirmed");
      const noEmail = channelId("noemail");
      const never = channelId("never");
      const shortlisted = channelId("shortlisted");
      const drafted = channelId("drafted");
      const inSequence = channelId("sequence");
      const emailedBefore = channelId("emailed");
      states = [
        confirmed(sam),
        confirmed(unconfirmed, { emailConfirmed: false }),
        confirmed(noEmail, { email: null }),
        confirmed(never, { stage: "never" }),
        confirmed(shortlisted, { stage: "shortlisted" }),
        confirmed(drafted),
        confirmed(inSequence),
        confirmed(emailedBefore),
      ];
      seed("old", drafted, { state: "ready", subject: "s", body: "b" });
      store.sequences.set(inSequence, {
        creator: inSequence,
        mailbox: "moustafa@gratovo.example",
        startedAt: start,
        steps: [],
        stopped: null,
        parkUntil: null,
      });
      store.messages.push({
        creator: emailedBefore,
        message: {
          id: "m1",
          direction: "out",
          kind: "first",
          followUp: null,
          subject: "hi",
          body: "Hi, your AI news recap was clear.",
          bodyCut: false,
          at: start - 86_400_000,
          mailbox: "moustafa@gratovo.example",
          peer: null,
          peerName: null,
          by: "u1",
          source: "imported",
          reading: null,
        },
      });

      await kicked();

      const made = drafts().filter((d) => d.id !== "old");
      expect(made.map((d) => d.creator)).toEqual([sam]);
      // The mailbox with the most sends left today.
      expect(made[0]).toMatchObject({ kind: "first", mailbox: "moustafa@gratovo.example" });
      expect(propose).toHaveBeenCalledOnce();
      expect(propose.mock.calls[0]?.[0].request).toEqual({
        kind: "first",
        channelId: sam,
        contactEmail: confirmed(sam).email,
        threadId: `c:${sam}`,
        timeoutS: 240,
      });
      expect(propose.mock.calls[0]?.[0].facts.agency?.sender).toBe("Moustafa");
    });

    describe("follow-ups (D22)", () => {
      const day = 86_400_000;
      const running = (creator: string, over: Partial<Sequence> = {}): Sequence => ({
        creator,
        mailbox: "lina@gratovo.example",
        startedAt: start - 8 * day,
        steps: [
          { n: 1, dueAt: start - 5 * day, state: "sent", sentAt: start - 5 * day },
          { n: 2, dueAt: start - day, state: "planned", sentAt: null },
          { n: 3, dueAt: start + 6 * day, state: "planned", sentAt: null },
        ],
        stopped: null,
        parkUntil: null,
        ...over,
      });

      it("drafts the lowest due step once, from the sequence's mailbox, and never approves it", async () => {
        states = [confirmed(sam, { stage: "emailed" })];
        store.sequences.set(sam, running(sam));
        await kicked();
        await kicked();
        expect(drafts()).toHaveLength(1);
        expect(only()).toMatchObject({
          kind: "followUp",
          followUp: 2,
          mailbox: "lina@gratovo.example",
        });
        expect(["drafting", "ready"]).toContain(only().state);
        expect(store.sequences.get(sam)?.steps.map((x) => x.state)).toEqual([
          "sent",
          "drafted",
          "planned",
        ]);
        expect(propose.mock.calls[0]?.[0].request).toMatchObject({
          kind: "followUp",
          followUpNumber: 2,
        });
        expect(drafts().every((d) => d.state !== "approved" && d.state !== "scheduled")).toBe(true);
      });

      it("drafts nothing while stopped or parked, or for a creator who is not emailed", async () => {
        const a = channelId("stopped");
        const b = channelId("parked");
        const c = channelId("replied");
        const d = channelId("future");
        states = [
          confirmed(a, { stage: "emailed" }),
          confirmed(b, { stage: "parked" }),
          confirmed(c, { stage: "replied" }),
          confirmed(d, { stage: "emailed" }),
        ];
        store.sequences.set(a, running(a, { stopped: "you" }));
        store.sequences.set(b, running(b, { parkUntil: start + 10 * day }));
        store.sequences.set(c, running(c));
        store.sequences.set(
          d,
          running(d, { steps: [{ n: 1, dueAt: start + day, state: "planned", sentAt: null }] }),
        );
        await kicked();
        expect(drafts()).toEqual([]);
      });

      it("drafts nothing while the creator has an open draft", async () => {
        states = [confirmed(sam, { stage: "emailed" })];
        store.sequences.set(sam, running(sam));
        seed("open", sam, { state: "ready", kind: "reply" });
        await kicked();
        expect(drafts().map((x) => x.id)).toEqual(["open"]);
      });
    });

    it("waits 2 s after the last kick, and looks once", async () => {
      vi.useFakeTimers();
      drafter = make({ realTimers: true });
      states = [confirmed(sam)];
      drafter.kick();
      await vi.advanceTimersByTimeAsync(kickDelayMs - 1);
      drafter.kick();
      await vi.advanceTimersByTimeAsync(kickDelayMs - 1);
      expect(drafts()).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      await drafter.idle();
      expect(drafts()).toHaveLength(1);
      expect(propose).toHaveBeenCalledOnce();
    });

    it("skips the open draft of a creator whose stage became never", async () => {
      states = [creatorState(sam, { stage: "never" }), creatorState(kai, { stage: "never" })];
      seed("a", sam, { state: "ready", subject: "s", body: "b" });
      seed("b", kai, { state: "failed", problem: "engine_failed" });
      seed("c", kai, { state: "sent" });

      await kicked();

      expect(store.draft("a")?.state).toBe("skipped");
      expect(store.draft("b")?.state).toBe("skipped");
      expect(store.draft("c")?.state).toBe("sent");
      expect(propose).not.toHaveBeenCalled();
      expect(changed).toHaveBeenCalled();
    });

    it("skips a queued draft whose creator turned never before its turn", async () => {
      states = [creatorState(sam, { stage: "never" })];
      seed("a", sam);
      await kicked();
      expect(store.draft("a")?.state).toBe("skipped");
      expect(propose).not.toHaveBeenCalled();
    });
  });

  describe("the queue", () => {
    it("makes one call at a time, oldest first", async () => {
      states = [confirmed(sam), confirmed(kai)];
      const finish: ((call: Call) => void)[] = [];
      propose.mockImplementation(
        () =>
          new Promise<Call>((resolve) => {
            finish.push(resolve);
          }),
      );
      drafter.kick();
      await vi.waitFor(() => {
        expect(propose).toHaveBeenCalledOnce();
      });
      // Another kick while the call runs adds nothing and asks nothing more.
      drafter.kick();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(propose).toHaveBeenCalledOnce();
      expect(propose.mock.calls[0]?.[0].request.channelId).toBe(sam);
      finish[0]?.(answered());
      await vi.waitFor(() => {
        expect(propose).toHaveBeenCalledTimes(2);
      });
      expect(propose.mock.calls[1]?.[0].request.channelId).toBe(kai);
      finish[1]?.(answered());
      await drafter.idle();
      expect(drafts().map((d) => d.state)).toEqual(["ready", "ready"]);
      expect(drafts()).toHaveLength(2);
    });

    it("takes replies, then follow-ups, then first emails", async () => {
      states = [
        creatorState(sam, { stage: "replied", email: "sam@x.example", emailConfirmed: true }),
        creatorState(kai, { stage: "emailed", email: "kai@x.example", emailConfirmed: true }),
        confirmed(tess),
      ];
      seed("first", tess);
      clock += 1;
      store.insertDraft({
        id: "follow",
        creator: kai,
        kind: "followUp",
        followUp: 2,
        mailbox: null,
        replyTo: null,
        at: clock,
      });
      clock += 1;
      store.insertDraft({
        id: "reply",
        creator: sam,
        kind: "reply",
        followUp: null,
        mailbox: null,
        replyTo: "m9",
        at: clock,
      });

      await kicked();

      expect(propose.mock.calls.map((call) => call[0].request.kind)).toEqual([
        "reply",
        "followUp",
        "first",
      ]);
      expect(propose.mock.calls[1]?.[0].request.followUpNumber).toBe(2);
    });

    it("keeps rows drafting and calls nothing while the bridge is off", async () => {
      bridge = { ready: false, pausedUntil: null };
      states = [confirmed(sam), confirmed(kai)];

      await kicked();

      expect(propose).not.toHaveBeenCalled();
      expect(drafts().map((d) => [d.state, d.problem])).toEqual([
        ["drafting", "bridge_off"],
        ["drafting", "bridge_off"],
      ]);
      expect(drafter.state()).toEqual({ gemini: "off", pausedUntil: null });

      // The bridge turns ready: the next kick drafts them.
      bridge = { ready: true, pausedUntil: null };
      await kicked();
      expect(propose).toHaveBeenCalledTimes(2);
      expect(drafts().map((d) => [d.state, d.problem])).toEqual([
        ["ready", null],
        ["ready", null],
      ]);
      expect(drafter.state()).toEqual({ gemini: "ready", pausedUntil: null });
    });

    it("waits while the bridge is paused, and starts again after", async () => {
      const until = start + 20 * 60_000;
      bridge = { ready: true, pausedUntil: until };
      states = [confirmed(sam)];

      await kicked();

      expect(propose).not.toHaveBeenCalled();
      expect(only()).toMatchObject({ state: "drafting", problem: "paused" });
      expect(drafter.state()).toEqual({ gemini: "paused", pausedUntil: until });
      expect(held.map((h) => h.ms)).toEqual([20 * 60_000]);

      clock = until;
      bridge = { ready: true, pausedUntil: null };
      held[0]?.release();
      await vi.waitFor(() => {
        expect(propose).toHaveBeenCalledOnce();
      });
      await drafter.idle();
      expect(only()).toMatchObject({ state: "ready", problem: null });
      expect(drafter.state().gemini).toBe("ready");
    });

    it("keeps the rows drafting when the bridge answers PAUSED, until the time it names", async () => {
      states = [confirmed(sam), confirmed(kai)];
      propose.mockResolvedValueOnce(
        failed("PAUSED", "Gemini refused a prompt about Sam", { until: "2026-10-25T09:30:00Z" }),
      );
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

      await kicked();

      expect(propose).toHaveBeenCalledOnce();
      expect(drafts().map((d) => [d.state, d.problem])).toEqual([
        ["drafting", "paused"],
        ["drafting", "paused"],
      ]);
      const until = Date.UTC(2026, 9, 25, 9, 30);
      expect(drafter.state()).toEqual({ gemini: "paused", pausedUntil: until });
      expect(held.map((h) => h.ms)).toEqual([until - start]);
      expect(logged).toHaveBeenCalledWith("Reach: drafting failed (PAUSED).");

      clock = until;
      held[0]?.release();
      await vi.waitFor(() => {
        expect(propose).toHaveBeenCalledTimes(3);
      });
      await drafter.idle();
      expect(drafts().map((d) => d.state)).toEqual(["ready", "ready"]);
    });

    it("keeps the rows drafting with no_sender when there is no name to sign with", async () => {
      sender = null;
      states = [confirmed(sam)];
      await kicked();
      expect(propose).not.toHaveBeenCalled();
      expect(bridgeChecks).toBe(0);
      expect(only()).toMatchObject({ state: "drafting", problem: "no_sender" });
      expect(drafter.state()).toEqual({ gemini: "no_sender", pausedUntil: null });
    });

    it("maps a real engine answer into the draft", async () => {
      states = [confirmed(sam)];
      await kicked();
      const draft = only();
      expect(draft).toMatchObject({
        state: "ready",
        subject: "your claude code test",
        body: SAM_BODY,
        problem: null,
        edited: false,
      });
      expect(draft.proposal).toEqual({
        status: "needs_human",
        why: "Open on the Cursor test from their latest video, then ask one small question.",
        rules: ["INF-FIRST-02", "FND-WRITE-11"],
        findings: [
          { rule: "INF-FIRST-07", text: "the ask leans on what we want", blocking: false },
          { rule: "COURSE_CHECK_SKIPPED", text: "no course loaded", blocking: false },
        ],
        gates: [
          { key: "fact_missing-0", kind: "fact_missing", text: "confirm the contact's first name" },
          {
            key: "price-1",
            kind: "price",
            text: "the message names a price, amount or percentage",
          },
          { key: "other-2", kind: "other", text: "the model's own" },
        ],
        situation: {
          side: "influencer",
          stage: "prospect",
          replyType: null,
          summary: "A first email to an AI coding channel.",
        },
        model: "Gemini 3 Pro",
      });
      expect(draftProposalSchema.safeParse(draft.proposal).success).toBe(true);
      const { approvedBy, checkedHash, steer, ...frame } = draft;
      expect([approvedBy, checkedHash, steer]).toEqual([null, null, null]);
      expect(outreachDraftSchema.safeParse(frame).success).toBe(true);
    });

    it("keeps a blocked answer as a ready draft, its block for the gates to hold", async () => {
      states = [confirmed(sam)];
      propose.mockResolvedValueOnce(
        answered(
          engineResult({
            status: "blocked",
            findings: [
              { code: "SPAM_WORD", severity: "block", rule: "FND-WRITE-12", detail: "'offer'" },
            ],
          }),
        ),
      );
      await kicked();
      expect(only()).toMatchObject({ state: "ready", body: SAM_BODY });
      expect(only().proposal?.status).toBe("blocked");
      expect(only().proposal?.findings[0]?.blocking).toBe(true);
    });

    it("fails with engine_blocked when the engine has no message", async () => {
      states = [confirmed(sam), confirmed(kai)];
      propose
        .mockResolvedValueOnce(
          answered(engineResult({ status: "no_message", proposal: null, gates: [] })),
        )
        .mockResolvedValueOnce(
          answered(
            engineResult({
              status: "ready",
              proposal: { decision: { why: "wait", rules: [] }, message: null },
            }),
          ),
        );
      await kicked();
      expect(drafts().map((d) => [d.state, d.problem])).toEqual([
        ["failed", "engine_blocked"],
        ["failed", "engine_blocked"],
      ]);
      expect(drafts()[1]?.proposal?.why).toBe("wait");
    });

    it("fails a body too long for a draft with engine_failed", async () => {
      states = [confirmed(sam)];
      const long = engineResult();
      propose.mockResolvedValueOnce(
        answered({
          ...long,
          proposal: { ...long.proposal, message: { subject: "s", body: "x".repeat(20_001) } },
        }),
      );
      await kicked();
      expect(only()).toMatchObject({ state: "failed", problem: "engine_failed", body: "" });
    });

    it("fails a failed call with engine_failed, logging the code and never the text", async () => {
      states = [confirmed(sam), confirmed(kai)];
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
      propose
        .mockResolvedValueOnce(failed("GEMINI_ERROR", `Gemini choked on: ${SAM_BODY}`))
        .mockResolvedValueOnce(failed("TIMEOUT", "No answer to the prompt about Kai."));
      await kicked();
      expect(drafts().map((d) => [d.state, d.problem])).toEqual([
        ["failed", "engine_failed"],
        ["failed", "engine_failed"],
      ]);
      expect(logged.mock.calls).toEqual([
        ["Reach: drafting failed (GEMINI_ERROR)."],
        ["Reach: drafting failed (TIMEOUT)."],
      ]);
      const said = JSON.stringify(logged.mock.calls);
      expect(said).not.toContain("Sam");
      expect(said).not.toContain("Kai");
    });

    it("keeps the rows drafting with bridge_off when the bridge went away under the call", async () => {
      states = [confirmed(sam), confirmed(kai)];
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      propose.mockResolvedValueOnce(failed("EXTENSION_NOT_CONNECTED"));
      await kicked();
      expect(propose).toHaveBeenCalledOnce();
      expect(drafts().map((d) => [d.state, d.problem])).toEqual([
        ["drafting", "bridge_off"],
        ["drafting", "bridge_off"],
      ]);
      expect(drafter.state().gemini).toBe("off");

      propose.mockResolvedValueOnce(failed("NOT_RUNNING"));
      await kicked();
      expect(drafts().every((d) => d.state === "drafting")).toBe(true);
    });

    it("never leaves a draft approved, whatever the engine says", async () => {
      states = [confirmed(sam), confirmed(kai), confirmed(tess)];
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      propose
        .mockResolvedValueOnce(answered(engineResult({ status: "ready", gates: [] })))
        .mockResolvedValueOnce(answered(engineResult({ status: "blocked" })))
        .mockResolvedValueOnce(failed("INTERNAL"));
      await kicked();
      expect(drafts().map((d) => d.state)).toEqual(["ready", "ready", "failed"]);
      expect(drafts().every((d) => d.approvedBy === null && d.sendAt === null)).toBe(true);
    });

    it("drops the queue on a source switch: a late answer writes nothing", async () => {
      states = [confirmed(sam)];
      let finish: (call: Call) => void = () => undefined;
      propose.mockImplementationOnce(
        () =>
          new Promise<Call>((resolve) => {
            finish = resolve;
          }),
      );
      drafter.kick();
      await vi.waitFor(() => {
        expect(propose).toHaveBeenCalledOnce();
      });
      drafter.drop();
      finish(answered());
      await drafter.idle();
      expect(only()).toMatchObject({ state: "drafting", body: "" });

      // The next kick picks the row up again.
      await kicked();
      expect(only()).toMatchObject({ state: "ready", body: SAM_BODY });
    });
  });

  describe("on the example data", () => {
    beforeEach(() => {
      mode = "example";
    });

    it("fills a first email after 0.9 s and never calls Gemini", async () => {
      vi.useFakeTimers();
      drafter = make({ realTimers: true });
      states = [confirmed(sam, { name: "Prompt Lab", contactName: "Sam" })];
      bridge = { ready: false, pausedUntil: null };
      drafter.kick();
      await vi.advanceTimersByTimeAsync(kickDelayMs + standInMs - 1);
      expect(only()).toMatchObject({ state: "drafting" });
      await vi.advanceTimersByTimeAsync(1);
      await drafter.idle();
      const draft = only();
      expect(draft).toMatchObject({ state: "ready", subject: "your latest video", problem: null });
      expect(draft.body.startsWith("Hi Sam,\n\n")).toBe(true);
      expect(draft.body).toContain("Prompt Lab");
      expect(draft.body.endsWith("\n\nMoustafa")).toBe(true);
      expect(draft.body.split("\n\n")).toHaveLength(5);
      expect(draft.proposal).toMatchObject({
        status: "ready",
        rules: ["INF-FIRST-02", "FND-WRITE-11"],
        why: reachStrings.standIn.why,
      });
      expect(propose).not.toHaveBeenCalled();
      expect(bridgeChecks).toBe(0);
    });

    it("rewrites with a stand-in edit after 0.9 s, never calling Gemini", async () => {
      states = [confirmed(sam, { name: "Prompt Lab", contactName: "Sam" })];
      await kicked();
      const before = only().body;
      expect(await drafter.rewrite(only().id, "shorter")).toEqual({ ok: true });
      expect(only().rewriting).toBe("shorter");
      await drafter.idle();
      expect(only()).toMatchObject({
        rewriting: null,
        body: standInRewrite(before, "shorter"),
        edited: false,
        steer: { how: "shorter", note: reachStrings.rewriteNotes.shorter },
      });
      expect(propose).not.toHaveBeenCalled();
    });
  });

  describe("the stand-in edits", () => {
    const body = [
      "Hi Sam,",
      "Thanks for the latest Prompt Lab video, it was a pleasure to watch.\nThe test was easy to follow.",
      "We work with AI tool makers who sponsor creators.",
      "Would you be open to a short note about it?",
      "Moustafa",
    ].join("\n\n");

    it("shorter keeps the first and last paragraphs", () => {
      expect(standInRewrite(body, "shorter")).toBe(
        [
          "Hi Sam,",
          "Thanks for the latest Prompt Lab video, it was a pleasure to watch.\nThe test was easy to follow.",
          "Would you be open to a short note about it?",
          "Moustafa",
        ].join("\n\n"),
      );
    });

    it("warmer adds a friendly opening line", () => {
      expect(standInRewrite(body, "warmer")).toContain(
        `Hi Sam,\n\n${reachStrings.standInRewrite.warmerLine}\nThanks for the latest`,
      );
    });

    it("direct removes the opening pleasantry", () => {
      const direct = standInRewrite(body, "direct");
      expect(direct).not.toContain("pleasure");
      expect(direct.startsWith("Hi Sam,\n\nThe test was easy to follow.\n\n")).toBe(true);
    });

    it("a new angle replaces the second paragraph's first line", () => {
      const redo = standInRewrite(body, "redo");
      expect(redo).toContain(reachStrings.standInRewrite.redoLine);
      expect(redo).not.toContain("We work with AI tool makers");
      expect(standInRewrite(redo, "redo")).toBe(redo);
    });
  });

  describe("rewrites", () => {
    beforeEach(() => {
      states = [confirmed(sam)];
      seed("a", sam, {
        state: "ready",
        subject: "old subject",
        body: "old body",
        edited: true,
        proposal: mapProposal(engineResult()).proposal,
      });
    });

    it("re-proposes with the steer note, then puts the new text in", async () => {
      let finish: (call: Call) => void = () => undefined;
      propose.mockImplementationOnce(
        () =>
          new Promise<Call>((resolve) => {
            finish = resolve;
          }),
      );
      expect(await drafter.rewrite("a", "warmer")).toEqual({ ok: true });
      expect(store.draft("a")).toMatchObject({
        rewriting: "warmer",
        steer: { how: "warmer", note: "Make it warmer, without flattery." },
      });
      await vi.waitFor(() => {
        expect(propose).toHaveBeenCalledOnce();
      });
      expect(propose.mock.calls[0]?.[0].request).toMatchObject({
        kind: "first",
        channelId: sam,
        threadId: `c:${sam}`,
        steer: { note: "Make it warmer, without flattery." },
        timeoutS: 240,
      });
      expect(await drafter.rewrite("a", "shorter")).toEqual({ ok: false, problem: "busy" });

      finish(answered());
      await drafter.idle();
      expect(store.draft("a")).toMatchObject({
        state: "ready",
        rewriting: null,
        subject: "your claude code test",
        body: SAM_BODY,
        edited: false,
        problem: null,
      });
      expect(changed).toHaveBeenCalled();
    });

    it("says Gemini is off on live data until it has looked, and ready on example data", async () => {
      mode = "live";
      const fresh = make();
      expect(fresh.state().gemini).toBe("off");
      bridge = { ready: true, pausedUntil: null };
      fresh.kick();
      await fresh.idle();
      expect(fresh.state().gemini).toBe("ready");
      mode = "example";
      expect(make().state().gemini).toBe("ready");
    });

    it("answers bridge_off and paused without a call", async () => {
      bridge = { ready: false, pausedUntil: null };
      expect(await drafter.rewrite("a", "direct")).toEqual({ ok: false, problem: "bridge_off" });
      bridge = { ready: true, pausedUntil: start + 60_000 };
      expect(await drafter.rewrite("a", "direct")).toEqual({ ok: false, problem: "paused" });
      expect(propose).not.toHaveBeenCalled();
      expect(store.draft("a")?.rewriting).toBeNull();
    });

    it("answers not_found and busy for a draft it can't rewrite", async () => {
      expect(await drafter.rewrite("nope", "redo")).toEqual({ ok: false, problem: "not_found" });
      seed("b", kai, { state: "drafting" });
      expect(await drafter.rewrite("b", "redo")).toEqual({ ok: false, problem: "busy" });
      seed("c", tess, { state: "approved" });
      expect(await drafter.rewrite("c", "redo")).toEqual({ ok: false, problem: "busy" });
      seed("d", tess, { state: "failed", problem: "maybe_sent" });
      expect(await drafter.rewrite("d", "redo")).toEqual({ ok: false, problem: "busy" });
      mode = null;
      expect(await drafter.rewrite("a", "redo")).toEqual({ ok: false, problem: "not_found" });
      expect(propose).not.toHaveBeenCalled();
    });

    it("keeps the text when the rewrite fails, with the reason as a note", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      propose.mockResolvedValueOnce(failed("GEMINI_ERROR", "old body"));
      expect(await drafter.rewrite("a", "redo")).toEqual({ ok: true });
      await drafter.idle();
      expect(store.draft("a")).toMatchObject({
        state: "ready",
        subject: "old subject",
        body: "old body",
        rewriting: null,
        problem: "engine_failed",
      });
    });

    it("leaves a draft a person sent meanwhile as it is", async () => {
      let finish: (call: Call) => void = () => undefined;
      propose.mockImplementationOnce(
        () =>
          new Promise<Call>((resolve) => {
            finish = resolve;
          }),
      );
      await drafter.rewrite("a", "shorter");
      await vi.waitFor(() => {
        expect(propose).toHaveBeenCalledOnce();
      });
      store.updateDraft("a", { state: "approved" }, clock);
      finish(answered());
      await drafter.idle();
      expect(store.draft("a")).toMatchObject({
        state: "approved",
        body: "old body",
        rewriting: null,
      });
    });
  });

  describe("retry and draft now", () => {
    it("puts a draft whose drafting failed back in the queue", async () => {
      states = [confirmed(sam)];
      seed("a", sam, { state: "failed", problem: "engine_failed" });
      expect(await drafter.retry("a")).toEqual({ ok: true });
      await drafter.idle();
      expect(store.draft("a")).toMatchObject({ state: "ready", body: SAM_BODY, problem: null });
    });

    it("refuses a failed send, a ready draft and an unknown one", async () => {
      states = [confirmed(sam), confirmed(kai)];
      seed("a", sam, { state: "failed", problem: "maybe_sent" });
      seed("b", kai, { state: "ready" });
      expect(await drafter.retry("a")).toEqual({ ok: false, problem: "wrong_state" });
      expect(await drafter.retry("b")).toEqual({ ok: false, problem: "wrong_state" });
      expect(await drafter.retry("nope")).toEqual({ ok: false, problem: "not_found" });
      await drafter.idle();
      expect(propose).not.toHaveBeenCalled();
    });

    it("drafts now for a creator due a first email, and says why not otherwise", async () => {
      states = [confirmed(sam), confirmed(kai, { emailConfirmed: false }), confirmed(tess)];
      seed("t", tess, { state: "ready" });
      expect(await drafter.draftNow(kai)).toEqual({ ok: false, problem: "not_ready" });
      expect(await drafter.draftNow(channelId("unknown"))).toEqual({
        ok: false,
        problem: "not_ready",
      });
      expect(await drafter.draftNow(tess)).toEqual({ ok: false, problem: "has_draft" });
      expect(await drafter.draftNow(sam)).toEqual({ ok: true });
      await drafter.idle();
      expect(store.openDraft(sam)).toMatchObject({ state: "ready", body: SAM_BODY });
      expect(await drafter.draftNow(sam)).toEqual({ ok: false, problem: "has_draft" });
      mode = null;
      expect(await drafter.draftNow(sam)).toEqual({ ok: false, problem: "no_data" });
    });
  });
});

describe("the drafter on a real live source", () => {
  let folder: string;
  let file: string;
  let live: DataSource | null;
  let ready: boolean;
  let propose: ReturnType<typeof vi.fn<(params: Params) => Promise<Call>>>;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "gratovo-drafter-"));
    file = join(folder, "gratovo.db");
    const db = openDatabase(file);
    try {
      upsertCreator(
        db,
        {
          id: sam,
          name: "Prompt Lab",
          handle: "@promptlab",
          stage: "contact",
          email: "sam@promptlab.example",
          emailConfirmed: true,
          contactName: "Sam",
        },
        start,
      );
      upsertCreator(
        db,
        {
          id: kai,
          name: "Code with Kai",
          handle: "@codewithkai",
          stage: "contact",
          email: "kai@codewithkai.example",
        },
        start,
      );
      upsertCreator(
        db,
        { id: tess, name: "Tensor Talk", handle: "@tensortalk", stage: "never", email: null },
        start,
      );
    } finally {
      db.close();
    }
    live = openLiveSource(file, "u1", () => start);
    ready = true;
    propose = vi.fn<(params: Params) => Promise<Call>>(() => Promise.resolve(answered()));
  });

  afterEach(async () => {
    live?.close();
    live = null;
    await rm(folder, { recursive: true, force: true });
  });

  function make(): Drafter {
    let n = 0;
    return createDrafter({
      mode: () => "live",
      source: () => live,
      bridge: () => Promise.resolve({ ready, pausedUntil: null }),
      propose,
      sender: () => "Moustafa",
      mailboxes: () => [mailbox("moustafa@gratovo.example", 12)],
      changed: () => undefined,
      now: () => start,
      newId: () => `draft-${String(++n)}`,
      wait: () => Promise.resolve(),
    });
  }

  it("stores the first email for the confirmed creator only, waiting while the bridge is off", async () => {
    const drafter = make();
    const outreach = (live as DataSource).outreach;
    ready = false;
    drafter.kick();
    await drafter.idle();
    expect(outreach.draftsIn(["drafting"]).map((d) => [d.creator, d.problem])).toEqual([
      [sam, "bridge_off"],
    ]);
    expect(propose).not.toHaveBeenCalled();

    ready = true;
    drafter.kick();
    await drafter.idle();
    expect(propose).toHaveBeenCalledOnce();
    const facts = propose.mock.calls[0]?.[0].facts;
    expect(facts?.thread).toMatchObject({ id: `c:${sam}`, contactEmail: "sam@promptlab.example" });
    const draft = outreach.openDraft(sam);
    expect(draft).toMatchObject({
      state: "ready",
      kind: "first",
      subject: "your claude code test",
      body: SAM_BODY,
      mailbox: "moustafa@gratovo.example",
      problem: null,
    });
    expect(draft?.proposal).toEqual(mapProposal(engineResult()).proposal);
    expect(outreach.openDraft(kai)).toBeNull();
    expect(outreach.openDraft(tess)).toBeNull();
    const parts = outreach.reachParts(start);
    expect(parts.drafts.map((d) => outreachDraftSchema.safeParse(d).success)).toEqual([true]);
  });

  it("rewrites a stored draft and clears its rewriting mark", async () => {
    const drafter = make();
    const outreach = (live as DataSource).outreach;
    drafter.kick();
    await drafter.idle();
    const id = outreach.openDraft(sam)?.id ?? "";
    propose.mockResolvedValueOnce(
      answered(
        engineResult({
          proposal: {
            ...engineResult().proposal,
            message: { subject: "your cursor test", body: "Hi Sam,\n\nShorter.\n\nMoustafa" },
          },
        }),
      ),
    );
    expect(await drafter.rewrite(id, "shorter")).toEqual({ ok: true });
    expect(outreach.draft(id)?.rewriting).toBe("shorter");
    await drafter.idle();
    expect(outreach.draft(id)).toMatchObject({
      state: "ready",
      subject: "your cursor test",
      rewriting: null,
      edited: false,
      steer: { how: "shorter", note: reachStrings.rewriteNotes.shorter },
    });
    expect(propose.mock.calls[1]?.[0].request.steer).toEqual({
      note: reachStrings.rewriteNotes.shorter,
    });
  });
});
