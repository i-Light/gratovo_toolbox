import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  exampleChannelId as ch,
  type DataSource,
  type DraftState,
  type Sequence,
} from "@gratovo/core/data";
import { withStep } from "@gratovo/core/reach";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { contractNow } from "../data/data-source-contract";
import { openExampleSource } from "../data/example-source";

import {
  createReachService,
  type ReachServiceDeps,
  type ReachServiceHandle,
} from "./reach-service";

/**
 * The follow-up sequences in main (plan step 6c, D22), on the real example source in a temp file:
 * the four commands, the day timer, and the proof that nothing here ever approves or sends.
 */

const day = 86_400_000;
const allStates: readonly DraftState[] = [
  "drafting",
  "ready",
  "failed",
  "approved",
  "scheduled",
  "sending",
  "sent",
  "skipped",
];

let folder: string;
let source: DataSource;
let clock: number;
let timers: { ms: number; run: () => void }[];
let runQuickJob: ReturnType<typeof vi.fn>;
let call: ReturnType<typeof vi.fn>;
let service: ReachServiceHandle;
let lines: string[];

function make(over: Partial<ReachServiceDeps> = {}): ReachServiceHandle {
  return createReachService({
    mode: () => "example",
    source: () => source,
    gemini: {
      status: () => ({
        state: "stopped",
        addon: { state: "missing", version: null },
        browser: null,
        problem: null,
      }),
      call: call as never,
    },
    jobs: { jobContext: () => null, secrets: {} as never },
    runQuickJob: runQuickJob as never,
    connected: () => Promise.resolve([]),
    emit: () => undefined,
    now: () => clock,
    setTimer: (run, ms) => {
      timers.push({ ms, run });
      return run;
    },
    clearTimer: (handle) => {
      timers = timers.filter((t) => t.run !== handle);
    },
    draftWait: () => Promise.resolve(),
    log: (line) => lines.push(line),
    ...over,
  });
}

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "gratovo-seq-"));
  clock = contractNow;
  timers = [];
  lines = [];
  runQuickJob = vi.fn();
  call = vi.fn();
  source = openExampleSource(join(folder, "example.db"), () => clock);
  service = make();
});

afterEach(async () => {
  service.dispose();
  source.close();
  await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const stageOf = async (id: string): Promise<string | undefined> =>
  (await source.creatorStates()).find((c) => c.id === id)?.stage;
const logTexts = async (): Promise<string[]> => (await source.frame()).log.map((l) => l.text);
const allDrafts = () => source.outreach.draftsIn(allStates);
const midnightAfter = (at: number): number => {
  const d = new Date(at);
  d.setHours(24, 0, 0, 0);
  return d.getTime() - at;
};

describe("the four sequence commands", () => {
  it("answer no_data with no source, and not_found for no creator or no sequence", async () => {
    const none = make({ source: () => null, mode: () => null });
    expect(await none.sequenceStop(ch("c8"))).toEqual({ ok: false, problem: "no_data" });
    expect(await none.sequenceResume(ch("c8"))).toEqual({ ok: false, problem: "no_data" });
    expect(await none.park(ch("c8"), clock + 20 * day)).toEqual({ ok: false, problem: "no_data" });
    expect(await none.wake(ch("c8"))).toEqual({ ok: false, problem: "no_data" });
    // c6 has no sequence; "nobody" is no creator.
    for (const id of [ch("c6"), "nobody"]) {
      expect(await service.sequenceStop(id)).toEqual({ ok: false, problem: "not_found" });
      expect(await service.sequenceResume(id)).toEqual({ ok: false, problem: "not_found" });
      expect(await service.park(id, clock + 20 * day)).toEqual({ ok: false, problem: "not_found" });
      expect(await service.wake(id)).toEqual({ ok: false, problem: "not_found" });
    }
  });

  it("stop skips the open follow-up drafts but not one being sent, and resume runs it again", async () => {
    for (const [id, state, n] of [
      ["f-ready", "ready", 1],
      ["f-approved", "approved", 2],
      ["f-sending", "sending", 3],
    ] as const) {
      source.outreach.insertDraft({
        id,
        creator: ch("c8"),
        kind: "followUp",
        followUp: n,
        mailbox: "outreach1@gratovo.example",
        replyTo: null,
        at: clock,
      });
      source.outreach.updateDraft(id, { state }, clock);
    }
    expect(await service.sequenceResume(ch("c8"))).toEqual({ ok: false, problem: "wrong_state" });
    expect(await service.sequenceStop(ch("c8"))).toEqual({
      ok: true,
      skipped: ["f-ready", "f-approved"],
    });
    expect(source.outreach.sequence(ch("c8"))?.stopped).toBe("you");
    expect(source.outreach.draft("f-ready")?.state).toBe("skipped");
    expect(source.outreach.draft("f-approved")?.state).toBe("skipped");
    expect(source.outreach.draft("f-sending")?.state).toBe("sending");
    expect(await logTexts()).toContain("Stopped the follow-ups to Ship AI");
    expect(await service.sequenceStop(ch("c8"))).toEqual({ ok: false, problem: "wrong_state" });

    expect(await service.sequenceResume(ch("c8"))).toEqual({ ok: true });
    expect(source.outreach.sequence(ch("c8"))?.stopped).toBeNull();
    expect(await logTexts()).toContain("Resumed the follow-ups to Ship AI");
    expect(await service.sequenceResume(ch("c8"))).toEqual({ ok: false, problem: "wrong_state" });
  });

  it("resume refuses a sequence that ended another way", async () => {
    const q = source.outreach.sequence(ch("c8")) as Sequence;
    source.outreach.commit({ at: clock, sequences: [{ ...q, stopped: "replied" }] });
    expect(await service.sequenceResume(ch("c8"))).toEqual({ ok: false, problem: "wrong_state" });
    expect(source.outreach.sequence(ch("c8"))?.stopped).toBe("replied");
  });

  it("park moves an emailed creator to parked with the drafts skipped; wake brings it back", async () => {
    // A day that is not ahead, the wrong stage and a stopped sequence are all refused.
    expect(await service.park(ch("c8"), clock)).toEqual({ ok: false, problem: "wrong_state" });
    expect(await service.park(ch("c8"), clock - day)).toEqual({
      ok: false,
      problem: "wrong_state",
    });
    expect(await service.park(ch("c10"), clock + 14 * day)).toEqual({
      ok: false,
      problem: "not_found",
    });
    expect(await service.wake(ch("c8"))).toEqual({ ok: false, problem: "wrong_state" });
    source.outreach.insertDraft({
      id: "f1",
      creator: ch("c8"),
      kind: "followUp",
      followUp: 1,
      mailbox: "outreach1@gratovo.example",
      replyTo: null,
      at: clock,
    });
    source.outreach.updateDraft("f1", { state: "ready" }, clock);

    const until = clock + 14 * day;
    expect(await service.park(ch("c8"), until)).toEqual({ ok: true, skipped: ["f1"] });
    expect(await stageOf(ch("c8"))).toBe("parked");
    const parkUntil = source.outreach.sequence(ch("c8"))?.parkUntil;
    expect(parkUntil).not.toBeNull();
    expect(new Date(parkUntil ?? 0).getHours()).toBe(0);
    expect(source.outreach.draft("f1")?.state).toBe("skipped");
    expect((await logTexts()).some((t) => t.startsWith("Parked Ship AI until "))).toBe(true);
    // Parked already: not emailed any more.
    expect(await service.park(ch("c8"), until)).toEqual({ ok: false, problem: "wrong_state" });

    expect(await service.wake(ch("c8"))).toEqual({ ok: true });
    expect(await stageOf(ch("c8"))).toBe("emailed");
    expect(source.outreach.sequence(ch("c8"))?.parkUntil).toBeNull();
    expect(await logTexts()).toContain("Woke Ship AI");
    expect(await service.wake(ch("c8"))).toEqual({ ok: false, problem: "wrong_state" });
  });

  it("park refuses a stopped sequence", async () => {
    await service.sequenceStop(ch("c8"));
    expect(await service.park(ch("c8"), clock + 14 * day)).toEqual({
      ok: false,
      problem: "wrong_state",
    });
    expect(await stageOf(ch("c8"))).toBe("emailed");
  });
});

describe("the day timer", () => {
  it("arms at start for the next local midnight, re-arms after it fires, and drop clears it", async () => {
    await service.opened();
    const first = timers.filter((t) => t.ms === midnightAfter(clock));
    expect(first).toHaveLength(1);
    clock += midnightAfter(clock) + 1000;
    first[0]?.run();
    const next = timers.filter((t) => t.ms === midnightAfter(clock));
    expect(next.length).toBeGreaterThanOrEqual(1);
    service.closed();
    expect(timers.filter((t) => t.ms === midnightAfter(clock))).toHaveLength(0);
  });

  it("finishes a sequence that ran out, once, with one log line", async () => {
    const q = source.outreach.sequence(ch("c9")) as Sequence;
    const sentAt = clock - 8 * day;
    source.outreach.commit({
      at: clock,
      sequences: [
        {
          ...q,
          startedAt: clock - 20 * day,
          steps: q.steps.map((s) => ({ ...s, state: "sent" as const, sentAt })),
        },
      ],
    });
    await service.opened();
    await vi.waitFor(() => {
      expect(source.outreach.sequence(ch("c9"))?.stopped).toBe("finished");
    });
    expect(
      (await logTexts()).filter(
        (t) => t === "The follow-ups to Diffusion Diaries are finished: no reply",
      ),
    ).toHaveLength(1);
    // The running one stays.
    expect(source.outreach.sequence(ch("c8"))?.stopped).toBeNull();
  });

  it("wakes a parked creator on the day: stage back to emailed, steps re-timed", async () => {
    await service.park(ch("c8"), clock + 14 * day);
    await service.opened();
    expect(await stageOf(ch("c8"))).toBe("parked");
    clock += 15 * day;
    const tick = timers.find((t) => t.ms === midnightAfter(clock - 15 * day));
    expect(tick).toBeDefined();
    tick?.run();
    await vi.waitFor(async () => {
      expect(await stageOf(ch("c8"))).toBe("emailed");
    });
    const q = source.outreach.sequence(ch("c8"));
    expect(q?.parkUntil).toBeNull();
    // Step 1 was due before the wake: it is due now, and the gaps stay.
    expect(q?.steps[0]?.dueAt).toBe(clock);
    expect((q?.steps[1]?.dueAt ?? 0) - (q?.steps[0]?.dueAt ?? 0)).toBe(4 * day);
    expect(await logTexts()).toContain("Woke Ship AI");
  });
});

describe("no automatic send", () => {
  it("drafts a due follow-up but never approves, schedules or sends it", async () => {
    await service.opened();
    // Weeks pass: every step of both sequences comes due, over and over.
    for (let i = 0; i < 6; i += 1) {
      clock += 5 * day;
      const tick = timers.filter((t) => t.ms > 1000).at(-1);
      timers = timers.filter((t) => t !== tick);
      tick?.run();
      await vi.waitFor(() => {
        const open = allDrafts().filter((d) => d.state === "drafting");
        expect(open).toEqual([]);
      });
      // Skip what was drafted, so the next step comes due.
      for (const d of allDrafts().filter((x) => x.kind === "followUp" && x.state === "ready")) {
        source.outreach.updateDraft(d.id, { state: "skipped" }, clock);
      }
    }
    const followUps = allDrafts().filter((d) => d.kind === "followUp");
    expect(followUps.length).toBeGreaterThan(0);
    expect(followUps.every((d) => d.state === "ready" || d.state === "skipped")).toBe(true);
    expect(allDrafts().some((d) => d.state === "approved" || d.state === "scheduled")).toBe(false);
    expect(allDrafts().some((d) => d.kind === "followUp" && d.approvedBy !== null)).toBe(false);
    expect(runQuickJob).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
    // One draft per creator at a time, and each step was drafted once.
    const perStep = followUps.map((d) => `${d.creator}:${String(d.followUp)}`);
    expect(new Set(perStep).size).toBe(perStep.length);
  });
});

/** A follow-up draft of c8 in the given state, with its step drafted. */
function openFollowUp(id: string, n: number, state: DraftState, body = "Hi Ship AI"): void {
  source.outreach.insertDraft({
    id,
    creator: ch("c8"),
    kind: "followUp",
    followUp: n,
    mailbox: "outreach1@gratovo.example",
    replyTo: null,
    at: clock,
  });
  source.outreach.updateDraft(
    id,
    { state, subject: body === "" ? "" : "a note", body, sendAt: clock + 10_000 },
    clock,
  );
  const q = source.outreach.sequence(ch("c8")) as Sequence;
  source.outreach.commit({ at: clock, sequences: [withStep(q, n, "drafted")] });
}

describe("an Undo of Stop or Park (review of 6c, finding 3)", () => {
  it("brings the skipped draft back as ready, never approved, its step drafted, nothing re-timed", async () => {
    openFollowUp("f1", 1, "approved");
    const stop = await service.sequenceStop(ch("c8"));
    expect(stop).toEqual({ ok: true, skipped: ["f1"] });
    expect(source.outreach.draft("f1")?.state).toBe("skipped");
    expect(source.outreach.sequence(ch("c8"))?.steps[0]?.state).toBe("planned");
    const timed = source.outreach.sequence(ch("c8"))?.steps.map((x) => x.dueAt);

    clock += 10 * day;
    expect(await service.sequenceResume(ch("c8"), ["f1", "nobody"])).toEqual({ ok: true });
    expect(source.outreach.draft("f1")).toMatchObject({
      state: "ready",
      approvedBy: null,
      sendAt: null,
      body: "Hi Ship AI",
    });
    const q = source.outreach.sequence(ch("c8"));
    expect(q?.stopped).toBeNull();
    expect(q?.steps[0]?.state).toBe("drafted");
    expect(q?.steps.map((x) => x.dueAt)).toEqual(timed);
  });

  it("puts a draft with no text back to drafting, and refuses another creator's, a non-skipped one and a second open one", async () => {
    openFollowUp("f1", 1, "drafting", "");
    expect(await service.sequenceStop(ch("c8"))).toEqual({ ok: true, skipped: ["f1"] });
    source.outreach.insertDraft({
      id: "other",
      creator: ch("c9"),
      kind: "followUp",
      followUp: 2,
      mailbox: null,
      replyTo: null,
      at: clock,
    });
    source.outreach.updateDraft("other", { state: "skipped" }, clock);
    expect(await service.sequenceResume(ch("c8"), ["other", "f1"])).toEqual({ ok: true });
    expect(source.outreach.draft("other")?.state).toBe("skipped");
    expect(source.outreach.draft("f1")?.state).toBe("drafting");

    // A new open draft since the Stop: nothing comes back on top of it.
    await service.sequenceStop(ch("c8"));
    expect(source.outreach.draft("f1")?.state).toBe("skipped");
    source.outreach.insertDraft({
      id: "newer",
      creator: ch("c8"),
      kind: "followUp",
      followUp: 2,
      mailbox: null,
      replyTo: null,
      at: clock,
    });
    await service.sequenceResume(ch("c8"), ["f1"]);
    expect(source.outreach.draft("f1")?.state).toBe("skipped");
  });

  it("without restore, resume re-times the planned steps to now", async () => {
    await service.sequenceStop(ch("c8"));
    clock += 10 * day;
    expect(await service.sequenceResume(ch("c8"))).toEqual({ ok: true });
    expect(source.outreach.sequence(ch("c8"))?.steps[0]?.dueAt).toBe(clock);
  });

  it("Park then Wake with restore brings the draft back and keeps the steps", async () => {
    openFollowUp("f1", 1, "ready");
    const parked = await service.park(ch("c8"), clock + 14 * day);
    expect(parked).toEqual({ ok: true, skipped: ["f1"] });
    const before = source.outreach.sequence(ch("c8"))?.steps.map((x) => x.dueAt);
    clock += 3 * day;
    expect(await service.wake(ch("c8"), ["f1"])).toEqual({ ok: true });
    expect(await stageOf(ch("c8"))).toBe("emailed");
    expect(source.outreach.draft("f1")?.state).toBe("ready");
    expect(source.outreach.sequence(ch("c8"))?.steps[0]?.state).toBe("drafted");
    expect(source.outreach.sequence(ch("c8"))?.steps.map((x) => x.dueAt)).toEqual(before);
  });
});

describe("wake, park and the day check (review of 6c, findings 4, 7 and 11)", () => {
  it("wakes a sequence whose date is set even when the stage moved on, and leaves the stage", async () => {
    await service.park(ch("c8"), clock + 14 * day);
    await source.write([
      { kind: "creator.stage", id: ch("c8"), stage: "replied", handle: "@shipai", name: "Ship AI" },
    ]);
    expect(await stageOf(ch("c8"))).toBe("replied");
    expect(await service.wake(ch("c8"))).toEqual({ ok: true });
    expect(source.outreach.sequence(ch("c8"))?.parkUntil).toBeNull();
    expect(await stageOf(ch("c8"))).toBe("replied");
  });

  it("wakes a parked stage whose date was lost, and refuses an awake creator", async () => {
    await service.park(ch("c8"), clock + 14 * day);
    const q = source.outreach.sequence(ch("c8")) as Sequence;
    source.outreach.commit({ at: clock, sequences: [{ ...q, parkUntil: null }] });
    expect(await service.wake(ch("c8"))).toEqual({ ok: true });
    expect(await stageOf(ch("c8"))).toBe("emailed");
    expect(await service.wake(ch("c8"))).toEqual({ ok: false, problem: "wrong_state" });
  });

  it("commits one wake for a double click", async () => {
    await service.park(ch("c8"), clock + 14 * day);
    const answers = await Promise.all([service.wake(ch("c8")), service.wake(ch("c8"))]);
    expect(answers.filter((a) => a.ok)).toHaveLength(1);
    expect(answers.filter((a) => !a.ok)).toEqual([{ ok: false, problem: "wrong_state" }]);
    expect((await logTexts()).filter((t) => t === "Woke Ship AI")).toHaveLength(1);
  });

  it("commits one wake for a Wake that meets the day check", async () => {
    await service.park(ch("c8"), clock + 14 * day);
    clock += 15 * day;
    const [, wake] = await Promise.all([service.dayTick(), service.wake(ch("c8"))]);
    expect(wake).toEqual({ ok: false, problem: "wrong_state" });
    expect((await logTexts()).filter((t) => t === "Woke Ship AI")).toHaveLength(1);
  });

  it("refuses a park day that is not a finite number", async () => {
    for (const until of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(await service.park(ch("c8"), until)).toEqual({ ok: false, problem: "wrong_state" });
    }
    expect(await stageOf(ch("c8"))).toBe("emailed");
  });

  it("the day check leaves a never-contact creator parked, with no line, and writes no stage for one that moved on", async () => {
    await service.park(ch("c8"), clock + 14 * day);
    await service.park(ch("c9"), clock + 14 * day);
    await source.write([
      { kind: "creator.stage", id: ch("c8"), stage: "never", handle: "@shipai", name: "Ship AI" },
      {
        kind: "creator.stage",
        id: ch("c9"),
        stage: "replied",
        handle: "@diffusion",
        name: "Diffusion Diaries",
      },
    ]);
    clock += 15 * day;
    await service.dayTick();
    expect(source.outreach.sequence(ch("c8"))?.parkUntil).not.toBeNull();
    expect(await stageOf(ch("c8"))).toBe("never");
    expect(await logTexts()).not.toContain("Woke Ship AI");
    expect(source.outreach.sequence(ch("c9"))?.parkUntil).toBeNull();
    expect(await stageOf(ch("c9"))).toBe("replied");
    // Not parked any more: it loses the stale date, and no line says it woke.
    expect(await logTexts()).not.toContain("Woke Diffusion Diaries");
  });

  it("runs the check again after the computer sleeps, sets the timer again, and is safe with no data", async () => {
    await service.opened();
    await service.park(ch("c8"), clock + 14 * day);
    clock += 15 * day;
    timers = [];
    await service.dayTick();
    expect(await stageOf(ch("c8"))).toBe("emailed");
    expect(timers.filter((t) => t.ms === midnightAfter(clock))).toHaveLength(1);
    const none = make({ source: () => null, mode: () => null });
    await expect(none.dayTick()).resolves.toBeUndefined();
  });

  it("tells the page about the log and the creators after a command and a wake", async () => {
    const emit = vi.fn();
    const mine = make({ emit });
    await mine.sequenceStop(ch("c8"));
    expect(emit).toHaveBeenLastCalledWith(["log", "creators"]);
    mine.dispose();
  });
});

describe("no automatic send, live mode", () => {
  const proposal = {
    status: "ready",
    proposal: {
      situation: {
        side: "influencer",
        stage: "prospect",
        reply_type: null,
        summary: "A follow-up.",
      },
      decision: { action: "send_message", why: "A short nudge.", rules: ["INF-FIRST-02"] },
      message: { channel: "email", subject: "a nudge", body: "Hi,\n\nA short note.\n\nMoustafa" },
      needs_human: [],
      follow_up: { in_working_days: 3, note: null },
      facts_used: [],
    },
    findings: [],
    gates: [],
    case: { side: "influencer", stage: "prospect", goal: "Follow up." },
    moments: [],
    momentsNote: null,
    seconds: 5,
    model: "Gemini 3 Pro",
    thinking: "High",
  };

  it("drafts follow-ups through Stop, Resume, Park, Wake and many day checks, and never approves or sends", async () => {
    const methods: string[] = [];
    const bridge = vi.fn((method: string) => {
      methods.push(method);
      if (method === "action.comms_propose") {
        return Promise.resolve({ ok: true, result: proposal });
      }
      if (method === "bridge.status") {
        return Promise.resolve({ ok: true, result: { pausedUntil: null } });
      }
      return Promise.resolve({
        ok: false,
        error: { code: "unavailable", message: "", details: {} },
      });
    });
    const live = make({
      mode: () => "live",
      gemini: {
        status: () => ({
          state: "listening",
          addon: { state: "connected", version: "1" },
          browser: null,
          problem: null,
        }),
        call: bridge as never,
      },
    });
    await live.overlay({ ...(await source.frame()), myName: "Moustafa" });
    const outBefore = source.outreach.recentOutbound(10_000).length;

    const checks = async (): Promise<void> => {
      await live.dayTick();
      await vi.waitFor(() => {
        expect(allDrafts().filter((d) => d.state === "drafting")).toEqual([]);
      });
    };
    const ageFollowUps = async (): Promise<void> => {
      // The person (or the page) skips what was drafted, so the next step can come due.
      await source.write(
        allDrafts()
          .filter((d) => d.kind === "followUp" && d.state === "ready")
          .map((d) => ({
            kind: "draft.state" as const,
            id: d.id,
            state: "skipped" as const,
            sendAt: null,
          })),
      );
    };

    for (let i = 0; i < 3; i += 1) {
      clock += 4 * day;
      await checks();
    }
    const drafted = allDrafts().filter((d) => d.kind === "followUp" && d.state === "ready");
    expect(drafted.length).toBeGreaterThan(0);

    const stop = await live.sequenceStop(ch("c8"));
    expect(stop.ok).toBe(true);
    await checks();
    const back = await live.sequenceResume(
      ch("c8"),
      stop.ok && "skipped" in stop ? stop.skipped : [],
    );
    expect(back).toEqual({ ok: true });
    await live.sequenceStop(ch("c8"));
    expect(await live.sequenceResume(ch("c8"))).toEqual({ ok: true });
    await checks();
    const park = await live.park(ch("c9"), clock + 10 * day);
    expect(park.ok).toBe(true);
    await live.wake(ch("c9"), park.ok && "skipped" in park ? park.skipped : []);
    await live.park(ch("c9"), clock + 10 * day);
    clock += 11 * day;
    await checks();
    await live.wake(ch("c9"));
    for (let i = 0; i < 4; i += 1) {
      await ageFollowUps();
      clock += 5 * day;
      await checks();
    }

    const everything = allDrafts();
    expect(
      everything.some((d) => ["approved", "scheduled", "sending", "sent"].includes(d.state)),
    ).toBe(false);
    expect(everything.every((d) => d.approvedBy === null)).toBe(true);
    expect(everything.every((d) => d.sendAt === null)).toBe(true);
    expect(runQuickJob).not.toHaveBeenCalled();
    expect(source.outreach.recentOutbound(10_000)).toHaveLength(outBefore);
    // The bridge was asked to write (so the run exercised live drafting), never anything else.
    expect(methods).toContain("action.comms_propose");
    live.dispose();
  });
});

describe("park and wake for a creator who replied (step 8, D9)", () => {
  /** A sequence a reply stopped, for a creator who has none (the example gives sequences to c8). */
  function stoppedFor(id: string, stopped: "replied" | "finished" | "you" = "replied"): void {
    const q = source.outreach.sequence(ch("c8")) as Sequence;
    source.outreach.commit({
      at: clock,
      sequences: [{ ...q, creator: id, stopped, parkUntil: null }],
    });
  }

  it("parks a kit creator whose sequence a reply stopped, and wakes it to kit without re-timing", async () => {
    stoppedFor(ch("c14"));
    const steps = source.outreach.sequence(ch("c14"))?.steps.map((x) => x.dueAt);
    expect(await stageOf(ch("c14"))).toBe("kit");
    expect(await service.park(ch("c14"), clock + 90 * day)).toEqual({ ok: true, skipped: [] });
    expect(await stageOf(ch("c14"))).toBe("parked");
    expect(source.outreach.sequence(ch("c14"))).toMatchObject({ stopped: "replied" });
    expect(source.outreach.sequence(ch("c14"))?.parkUntil).not.toBeNull();

    clock += 3 * day;
    expect(await service.wake(ch("c14"))).toEqual({ ok: true });
    expect(await stageOf(ch("c14"))).toBe("kit");
    const after = source.outreach.sequence(ch("c14"));
    expect(after?.stopped).toBe("replied");
    expect(after?.parkUntil).toBeNull();
    // A stopped sequence plans nothing: no step moved, no follow-up drafted.
    expect(after?.steps.map((x) => x.dueAt)).toEqual(steps);
    expect(allDrafts().filter((d) => d.creator === ch("c14"))).toEqual([]);
  });

  it("wakes a replied-stopped creator without a full kit to replied", async () => {
    // c16 has a rate and countries; take them away by parking a creator who has none: c10.
    stoppedFor(ch("c10"));
    expect(await stageOf(ch("c10"))).toBe("replied");
    expect(await service.park(ch("c10"), clock + 90 * day)).toEqual({ ok: true, skipped: [] });
    expect(await stageOf(ch("c10"))).toBe("parked");
    expect(await service.wake(ch("c10"))).toEqual({ ok: true });
    expect(await stageOf(ch("c10"))).toBe("replied");
  });

  it("the day timer wakes a parked, stopped sequence on its day", async () => {
    stoppedFor(ch("c14"));
    await service.park(ch("c14"), clock + 2 * day);
    clock += 3 * day;
    await service.dayTick();
    expect(await stageOf(ch("c14"))).toBe("kit");
    expect(source.outreach.sequence(ch("c14"))?.parkUntil).toBeNull();
  });

  it.each(["finished", "you"] as const)(
    "wakes a kit creator whose sequence was stopped %s before the reply to kit",
    async (stopped) => {
      stoppedFor(ch("c14"), stopped);
      expect(await service.park(ch("c14"), clock + 90 * day)).toEqual({ ok: true, skipped: [] });
      clock += 3 * day;
      expect(await service.wake(ch("c14"))).toEqual({ ok: true });
      expect(await stageOf(ch("c14"))).toBe("kit");
    },
  );

  it("the day timer wakes such a kit creator to kit too", async () => {
    stoppedFor(ch("c14"), "finished");
    await service.park(ch("c14"), clock + 2 * day);
    clock += 3 * day;
    await service.dayTick();
    expect(await stageOf(ch("c14"))).toBe("kit");
  });

  it("the day timer clears a stale date on a creator who is not parked, with no stage write or line", async () => {
    stoppedFor(ch("c14"), "replied");
    const q = source.outreach.sequence(ch("c14")) as Sequence;
    source.outreach.commit({ at: clock, sequences: [{ ...q, parkUntil: clock + 2 * day }] });
    expect(await stageOf(ch("c14"))).toBe("kit");
    clock += 3 * day;
    await service.dayTick();
    expect(await stageOf(ch("c14"))).toBe("kit");
    expect(source.outreach.sequence(ch("c14"))?.parkUntil).toBeNull();
    expect(await logTexts()).not.toContain("Woke AgentWorks");
  });

  it("an emailed creator still wakes to emailed, and a creator with no sequence can't be parked", async () => {
    expect(await service.park(ch("c8"), clock + 14 * day)).toEqual({ ok: true, skipped: [] });
    expect(await service.wake(ch("c8"))).toEqual({ ok: true });
    expect(await stageOf(ch("c8"))).toBe("emailed");
    expect(await service.park(ch("c15"), clock + 14 * day)).toEqual({
      ok: false,
      problem: "not_found",
    });
  });
});
