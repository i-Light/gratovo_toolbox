import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DataSource, DraftState, Sequence } from "@gratovo/core/data";
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
    expect(await none.sequenceStop("c8")).toEqual({ ok: false, problem: "no_data" });
    expect(await none.sequenceResume("c8")).toEqual({ ok: false, problem: "no_data" });
    expect(await none.park("c8", clock + 20 * day)).toEqual({ ok: false, problem: "no_data" });
    expect(await none.wake("c8")).toEqual({ ok: false, problem: "no_data" });
    // c6 has no sequence; "nobody" is no creator.
    for (const id of ["c6", "nobody"]) {
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
        creator: "c8",
        kind: "followUp",
        followUp: n,
        mailbox: "outreach1@gratovo.example",
        replyTo: null,
        at: clock,
      });
      source.outreach.updateDraft(id, { state }, clock);
    }
    expect(await service.sequenceResume("c8")).toEqual({ ok: false, problem: "wrong_state" });
    expect(await service.sequenceStop("c8")).toEqual({ ok: true });
    expect(source.outreach.sequence("c8")?.stopped).toBe("you");
    expect(source.outreach.draft("f-ready")?.state).toBe("skipped");
    expect(source.outreach.draft("f-approved")?.state).toBe("skipped");
    expect(source.outreach.draft("f-sending")?.state).toBe("sending");
    expect(await logTexts()).toContain("Stopped the follow-ups to Ship AI");
    expect(await service.sequenceStop("c8")).toEqual({ ok: false, problem: "wrong_state" });

    expect(await service.sequenceResume("c8")).toEqual({ ok: true });
    expect(source.outreach.sequence("c8")?.stopped).toBeNull();
    expect(await logTexts()).toContain("Resumed the follow-ups to Ship AI");
    expect(await service.sequenceResume("c8")).toEqual({ ok: false, problem: "wrong_state" });
  });

  it("resume refuses a sequence that ended another way", async () => {
    const q = source.outreach.sequence("c8") as Sequence;
    source.outreach.commit({ at: clock, sequences: [{ ...q, stopped: "replied" }] });
    expect(await service.sequenceResume("c8")).toEqual({ ok: false, problem: "wrong_state" });
    expect(source.outreach.sequence("c8")?.stopped).toBe("replied");
  });

  it("park moves an emailed creator to parked with the drafts skipped; wake brings it back", async () => {
    // A day that is not ahead, the wrong stage and a stopped sequence are all refused.
    expect(await service.park("c8", clock)).toEqual({ ok: false, problem: "wrong_state" });
    expect(await service.park("c8", clock - day)).toEqual({ ok: false, problem: "wrong_state" });
    expect(await service.park("c10", clock + 14 * day)).toEqual({
      ok: false,
      problem: "not_found",
    });
    expect(await service.wake("c8")).toEqual({ ok: false, problem: "wrong_state" });
    source.outreach.insertDraft({
      id: "f1",
      creator: "c8",
      kind: "followUp",
      followUp: 1,
      mailbox: "outreach1@gratovo.example",
      replyTo: null,
      at: clock,
    });
    source.outreach.updateDraft("f1", { state: "ready" }, clock);

    const until = clock + 14 * day;
    expect(await service.park("c8", until)).toEqual({ ok: true });
    expect(await stageOf("c8")).toBe("parked");
    const parkUntil = source.outreach.sequence("c8")?.parkUntil;
    expect(parkUntil).not.toBeNull();
    expect(new Date(parkUntil ?? 0).getHours()).toBe(0);
    expect(source.outreach.draft("f1")?.state).toBe("skipped");
    expect((await logTexts()).some((t) => t.startsWith("Parked Ship AI until "))).toBe(true);
    // Parked already: not emailed any more.
    expect(await service.park("c8", until)).toEqual({ ok: false, problem: "wrong_state" });

    expect(await service.wake("c8")).toEqual({ ok: true });
    expect(await stageOf("c8")).toBe("emailed");
    expect(source.outreach.sequence("c8")?.parkUntil).toBeNull();
    expect(await logTexts()).toContain("Woke Ship AI");
    expect(await service.wake("c8")).toEqual({ ok: false, problem: "wrong_state" });
  });

  it("park refuses a stopped sequence", async () => {
    await service.sequenceStop("c8");
    expect(await service.park("c8", clock + 14 * day)).toEqual({
      ok: false,
      problem: "wrong_state",
    });
    expect(await stageOf("c8")).toBe("emailed");
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
    const q = source.outreach.sequence("c9") as Sequence;
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
      expect(source.outreach.sequence("c9")?.stopped).toBe("finished");
    });
    expect(
      (await logTexts()).filter(
        (t) => t === "The follow-ups to Diffusion Diaries are finished: no reply",
      ),
    ).toHaveLength(1);
    // The running one stays.
    expect(source.outreach.sequence("c8")?.stopped).toBeNull();
  });

  it("wakes a parked creator on the day: stage back to emailed, steps re-timed", async () => {
    await service.park("c8", clock + 14 * day);
    await service.opened();
    expect(await stageOf("c8")).toBe("parked");
    clock += 15 * day;
    const tick = timers.find((t) => t.ms === midnightAfter(clock - 15 * day));
    expect(tick).toBeDefined();
    tick?.run();
    await vi.waitFor(async () => {
      expect(await stageOf("c8")).toBe("emailed");
    });
    const q = source.outreach.sequence("c8");
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
