import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { exampleChannelId as ch, type DataSource, type DraftState } from "@gratovo/core/data";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { contractNow } from "../data/data-source-contract";
import { openExampleSource } from "../data/example-source";
import type { JobOutcome } from "../pipeline/jobs";
import type { Start } from "../pipeline/protocol";

import {
  createReachService,
  type ReachServiceDeps,
  type ReachServiceHandle,
} from "./reach-service";
import { firstSweepMs, sweepEveryMs } from "./reply-sweep";
import type { Situations } from "./situations";

/**
 * Replies in the Reach service (plan step 6d, D23), on the real example source in a temp file:
 * Paste a reply end to end on example data, the sweep's timer and its jobs on live data with a fake
 * lane and a fake bridge, and the proof that an answer is only ever drafted.
 */

const hour = 3_600_000;
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

const situations: Situations = {
  list: () =>
    Promise.resolve([
      { id: "inf.gives_rate", label: "Gives their rate or rate card", side: "influencer" },
      { id: "inf.not_interested", label: "Not interested / no partnerships", side: "influencer" },
      { id: "inf.interested_vague", label: "Interested / vague", side: "influencer" },
    ]),
  labelOf: (id) =>
    Promise.resolve(
      {
        "inf.gives_rate": "Gives their rate or rate card",
        "inf.not_interested": "Not interested / no partnerships",
        "inf.interested_vague": "Interested / vague",
      }[id] ?? null,
    ),
};

let folder: string;
let source: DataSource;
let clock: number;
let timers: { ms: number; run: () => void }[];
let started: Start["job"][];
let service: ReachServiceHandle;
let emitted: (readonly string[] | undefined)[];
let lines: string[];
let replyLines: object[];
let call: ReturnType<typeof vi.fn>;

/** The fake quick lane: nothing is sent or read; `mail.replies` answers `replyLines`. */
function runQuickJob(start: Start): Promise<JobOutcome> {
  started.push(start.job);
  if (start.job.kind === "mail.replies") {
    return Promise.resolve({
      ok: true,
      replies: replyLines,
      exit: {
        kind: "ended",
        end: { type: "end", state: "done" },
        result: {
          type: "result",
          kind: "mail.replies",
          data: { accounts: [] },
        },
      },
    } as unknown as JobOutcome);
  }
  if (start.job.kind === "mail.ack") {
    return Promise.resolve({
      ok: true,
      replies: [],
      exit: {
        kind: "ended",
        end: { type: "end", state: "done" },
        result: { type: "result", kind: "mail.ack", data: { acknowledged: 1 } },
      },
    } as unknown as JobOutcome);
  }
  return Promise.resolve({ ok: false, problem: "no_python" });
}

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
    runQuickJob,
    connected: () => Promise.resolve([]),
    situations,
    emit: (more) => emitted.push(more),
    now: () => clock,
    setTimer: (run, ms) => {
      const entry = { ms, run };
      timers.push(entry);
      return entry;
    },
    clearTimer: (handle) => {
      timers = timers.filter((t) => t !== handle);
    },
    draftWait: () => Promise.resolve(),
    log: (line) => lines.push(line),
    ...over,
  });
}

const liveDeps: Partial<ReachServiceDeps> = {
  mode: () => "live",
  jobs: {
    jobContext: () => ({ dataDir: "data", worker: "w1" }),
    secrets: { get: () => Promise.resolve(undefined) } as never,
  },
  connected: () => Promise.resolve(["outreach1@gratovo.example"]),
};

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "gratovo-reach-replies-"));
  clock = contractNow;
  timers = [];
  started = [];
  emitted = [];
  lines = [];
  replyLines = [];
  call = vi.fn();
  source = openExampleSource(join(folder, "example.db"), () => clock);
  service = make();
});

afterEach(async () => {
  service.dispose();
  source.close();
  await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const drafts = () => source.outreach.draftsIn(allStates);
const answersOf = (id: string) => drafts().filter((d) => d.creator === id && d.kind === "reply");
const stageOf = async (id: string): Promise<string | undefined> =>
  (await source.creatorStates()).find((c) => c.id === id)?.stage;

describe("replies on example data", () => {
  it("never sweeps: Check now says example, and no job or Gemini call is made", async () => {
    await service.opened();
    expect(await service.checkReplies()).toEqual({ ok: false, problem: "example" });
    expect(timers.some((t) => t.ms === firstSweepMs)).toBe(false);
    expect(started).toEqual([]);
    expect(call).not.toHaveBeenCalled();
  });

  it("pastes a reply: the creator moves to replied, a stand-in answer is drafted and read", async () => {
    await service.overlay({ ...(await source.frame()), myName: "Moustafa" });
    expect(await service.pasteReply(ch("c9"), "Thanks! My rate is $900 per video.")).toEqual({
      ok: true,
    });
    expect(await stageOf(ch("c9"))).toBe("replied");
    expect(source.outreach.sequence(ch("c9"))?.stopped).toBe("replied");
    await vi.waitFor(() => {
      expect(answersOf(ch("c9"))[0]?.state).toBe("ready");
    });
    const answer = answersOf(ch("c9"))[0];
    expect(answer).toMatchObject({ kind: "reply", approvedBy: null, sendAt: null });
    expect(answer?.body.startsWith("Hi Theo,")).toBe(true);
    const frame = await source.frame();
    const thread = frame.reach.threads.find((t) => t.creator === ch("c9"));
    expect(thread?.lastIn?.reading).toMatchObject({
      replyType: "inf.gives_rate",
      corrected: false,
      facts: [{ key: "rate", rate: 900, saved: false }],
    });
    expect(started).toEqual([]);
    expect(call).not.toHaveBeenCalled();
    // The rail counts the answer.
    const out = await service.overlay(frame);
    expect(out.counts.reach).toBeGreaterThan(0);
  });

  it("changes a reading and writes the answer again with the stand-in", async () => {
    await service.overlay({ ...(await source.frame()), myName: "Moustafa" });
    await service.pasteReply(ch("c9"), "Maybe later.");
    await vi.waitFor(() => {
      expect(answersOf(ch("c9"))[0]?.state).toBe("ready");
    });
    const message = source.outreach
      .thread(ch("c9"), 10)
      .filter((m) => m.direction === "in")
      .at(-1);
    expect(await service.reclassify(message?.id ?? "none", "inf.not_interested")).toEqual({
      ok: true,
      rewritten: true,
    });
    expect(source.outreach.message(message?.id ?? "none")?.reading).toMatchObject({
      replyType: "inf.not_interested",
      label: "Not interested / no partnerships",
      corrected: true,
    });
    await vi.waitFor(() => {
      expect(answersOf(ch("c9"))[0]).toMatchObject({ state: "ready", rewriting: null });
    });
    expect(answersOf(ch("c9"))[0]?.steer?.note).toBe(
      "Read their reply as: Not interested / no partnerships",
    );
    expect(call).not.toHaveBeenCalled();
  });

  it("serves the situations and refuses nonsense", async () => {
    expect(await service.situations()).toMatchObject({
      ok: true,
      situations: [{ id: "inf.gives_rate", side: "influencer" }, {}, {}],
    });
    expect(await service.pasteReply(ch("c6"), "Hi")).toEqual({ ok: false, problem: "no_outbound" });
    expect(await service.reclassify("nope", "inf.gives_rate")).toEqual({
      ok: false,
      problem: "not_found",
    });
  });

  it("saves a fact from the seeded reply of Vector Vlog and shows it saved", async () => {
    const message = source.outreach
      .thread(ch("c10"), 10)
      .find((m) => m.direction === "in" && m.reading !== null);
    expect(message?.reading?.facts.map((f) => f.key)).toEqual(["rate", "countries", "age"]);
    await source.write([{ kind: "reply.fact", messageId: message?.id ?? "none", key: "rate" }]);
    const reading = (await source.frame()).reach.threads.find((t) => t.creator === ch("c10"))
      ?.lastIn?.reading;
    expect(reading?.facts.map((f) => [f.key, f.saved])).toEqual([
      ["rate", true],
      ["countries", false],
      ["age", false],
    ]);
  });
});

describe("the sweep on live data", () => {
  const fakeBridge = (replyType: string) =>
    vi.fn((method: string) => {
      if (method === "action.comms_propose") {
        return Promise.resolve({
          ok: true,
          result: {
            status: "ready",
            proposal: {
              situation: {
                side: "influencer",
                stage: "replied",
                reply_type: replyType,
                summary: "They would like to hear more.",
              },
              decision: { action: "send_message", why: "Answers the question.", rules: ["R1"] },
              message: {
                channel: "email",
                subject: "Re: hello",
                body: "Hi Mia,\n\nHappy to.\n\nMoustafa",
              },
              needs_human: [],
              facts_used: [],
            },
            findings: [],
            gates: [],
            case: { side: "influencer", stage: "replied", goal: "Answer." },
            moments: [],
            momentsNote: null,
            seconds: 5,
            model: "Gemini 3 Pro",
            thinking: "High",
          },
        });
      }
      if (method === "bridge.status") {
        return Promise.resolve({ ok: true, result: { pausedUntil: null } });
      }
      return Promise.resolve({
        ok: false,
        error: { code: "unavailable", message: "", details: {} },
      });
    });

  const reply = {
    type: "reply",
    account: "outreach1@gratovo.example",
    conversationKey: `c:${ch("c8")}`,
    channelId: ch("c8"),
    messageId: "gm-live-1",
    from: "team@shipai.dev",
    fromName: "Mia",
    subject: "Re: Your video on shipping AI features",
    body: "Thanks! Which brand is this?",
    bodyCut: false,
    receivedAt: new Date(contractNow - hour).toISOString(),
    isFirstReply: true,
    cancelledFollowUps: 0,
  };

  it("sweeps 30 s after opening, then every ten minutes, and stops when the data closes", async () => {
    const live = make(liveDeps);
    await live.opened();
    expect(timers.filter((t) => t.ms === firstSweepMs)).toHaveLength(1);
    expect(started.some((j) => j.kind === "mail.replies")).toBe(false);
    timers.find((t) => t.ms === firstSweepMs)?.run();
    await vi.waitFor(() => {
      expect(started.filter((j) => j.kind === "mail.replies")).toHaveLength(1);
      expect(timers.some((t) => t.ms === sweepEveryMs)).toBe(true);
    });
    live.closed();
    expect(timers.some((t) => t.ms === sweepEveryMs)).toBe(false);
    live.dispose();
  });

  it("answers Check now through the quick lane: stores, acknowledges what it stored, and drafts an answer", async () => {
    replyLines = [
      reply,
      {
        ...reply,
        messageId: "gm-live-2",
        channelId: "UCnobody",
        conversationKey: "x",
        from: "n@n.example",
      },
    ];
    const bridge = fakeBridge("inf.interested_vague");
    const live = make({
      ...liveDeps,
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
    expect(await live.checkReplies()).toEqual({ ok: true, stored: 1 });
    expect(started.map((j) => j.kind)).toEqual(["mail.replies", "mail.ack"]);
    expect(started[1]).toEqual({ kind: "mail.ack", messageIds: ["gm-live-1"] });
    expect(await stageOf(ch("c8"))).toBe("replied");
    // The page is told of the log, the creators and the notification.
    expect(emitted.some((more) => more?.includes("notify") === true)).toBe(true);
    await vi.waitFor(() => {
      expect(answersOf(ch("c8"))[0]?.state).toBe("ready");
    });
    const message = source.outreach
      .thread(ch("c8"), 10)
      .filter((m) => m.direction === "in")
      .at(-1);
    expect(message?.reading).toMatchObject({
      replyType: "inf.interested_vague",
      label: "Interested / vague",
      corrected: false,
    });
    live.dispose();
  });

  it("never sends: a swept reply, its answer and a reclassify leave nothing approved and no mail.send", async () => {
    replyLines = [reply];
    const live = make({
      ...liveDeps,
      gemini: {
        status: () => ({
          state: "listening",
          addon: { state: "connected", version: "1" },
          browser: null,
          problem: null,
        }),
        call: fakeBridge("inf.gives_rate") as never,
      },
    });
    await live.overlay({ ...(await source.frame()), myName: "Moustafa" });
    await live.checkReplies();
    await vi.waitFor(() => {
      expect(answersOf(ch("c8"))[0]?.state).toBe("ready");
    });
    const message = source.outreach
      .thread(ch("c8"), 10)
      .filter((m) => m.direction === "in")
      .at(-1);
    await live.reclassify(message?.id ?? "none", "inf.not_interested");
    await vi.waitFor(() => {
      expect(answersOf(ch("c8"))[0]?.rewriting).toBeNull();
    });
    await live.pasteReply(ch("c9"), "One from here too.");
    expect(
      drafts().some((d) => ["approved", "scheduled", "sending", "sent"].includes(d.state)),
    ).toBe(false);
    expect(drafts().every((d) => d.approvedBy === null && d.sendAt === null)).toBe(true);
    expect(started.some((j) => j.kind === "mail.send")).toBe(false);
    expect(started.every((j) => ["mail.status", "mail.replies", "mail.ack"].includes(j.kind))).toBe(
      true,
    );
    live.dispose();
  });

  it("answers Check now with no_mail before any job when no mailbox is connected", async () => {
    const live = make({ ...liveDeps, connected: () => Promise.resolve([]) });
    expect(await live.checkReplies()).toEqual({ ok: false, problem: "no_mail" });
    expect(started).toEqual([]);
    live.dispose();
  });

  it("logs the reply's id only when it can't be matched, never its words", async () => {
    replyLines = [
      {
        ...reply,
        channelId: null,
        conversationKey: "x",
        from: "n@n.example",
        body: "SECRET WORDS",
      },
    ];
    const live = make(liveDeps);
    expect(await live.checkReplies()).toEqual({ ok: true, stored: 0 });
    expect(lines.join("\n")).toContain("gm-live-1");
    expect(lines.join("\n")).not.toContain("SECRET");
    expect(started.map((j) => j.kind)).toEqual(["mail.replies"]);
    live.dispose();
  });
});
