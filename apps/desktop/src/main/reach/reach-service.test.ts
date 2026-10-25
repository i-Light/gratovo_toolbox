import { exampleFrame, type DataSource, type Frame, type StoredDraft } from "@gratovo/core/data";
import { describe, expect, it, vi } from "vitest";

import { zoneOf } from "@gratovo/core/reach";

import type { JobOutcome } from "../pipeline/jobs";
import type { Start } from "../pipeline/protocol";

import {
  changedGapMs,
  createReachService,
  exampleTestMs,
  type ReachServiceDeps,
} from "./reach-service";

const frame = exampleFrame(Date.UTC(2026, 9, 20));

function draft(over: Partial<StoredDraft>): StoredDraft {
  return {
    id: "d",
    creator: "c1",
    kind: "first",
    state: "ready",
    ...over,
  } as StoredDraft;
}

function withDrafts(drafts: readonly StoredDraft[]): Frame {
  return { ...frame, reach: { ...frame.reach, drafts } };
}

function fakeSource(): DataSource {
  return {
    frame: () => Promise.resolve(frame),
    creatorStates: () => Promise.resolve([]),
    readSetting: () => undefined,
    outreach: {
      reachParts: () => ({ drafts: [], sequences: [], threads: [] }),
      draft: () => null,
      draftsIn: () => [],
      openDraft: () => null,
      thread: () => [],
      hasOutbound: () => false,
      recentOutbound: () => [],
      sentSince: () => [],
      mailboxCounts: () => new Map(),
      sequence: () => null,
    },
  } as unknown as DataSource;
}

function make(over: Partial<ReachServiceDeps> = {}) {
  const emit = vi.fn();
  const runQuickJob = vi.fn();
  const call = vi.fn();
  const service = createReachService({
    mode: () => "example",
    source: fakeSource,
    gemini: {
      status: () => ({
        state: "stopped",
        addon: { state: "missing", version: null },
        browser: null,
        problem: null,
      }),
      call: call,
    },
    jobs: { jobContext: () => null, secrets: {} as never },
    runQuickJob,
    connected: () => Promise.resolve([]),
    emit,
    log: () => undefined,
    ...over,
  });
  return { service, emit, runQuickJob, call };
}

describe("the Reach service", () => {
  it("counts drafts waiting and replies to answer for the rail", async () => {
    const { service } = make();
    const out = await service.overlay(
      withDrafts([
        draft({ id: "a", kind: "first", state: "ready" }),
        draft({ id: "b", kind: "followUp", state: "failed" }),
        draft({ id: "c", kind: "first", state: "drafting" }),
        draft({ id: "d", kind: "first", state: "sent" }),
        draft({ id: "e", kind: "reply", state: "drafting" }),
        draft({ id: "f", kind: "reply", state: "skipped" }),
      ]),
    );
    expect(out.counts.reach).toBe(3);
    expect(out.reach.gemini).toBe("no_sender");
    expect(out.reach.mailboxes).toEqual([]);
  });

  it("counts the replies the Replies page counts, and no others", async () => {
    const { service } = make();
    const thread = (creator: string, answered: boolean) => ({
      creator,
      count: 2,
      lastOutAt: 1,
      answered,
      lastIn: { id: `m-${creator}`, at: 2, reading: null, preview: "Hi", bounce: false },
    });
    const [first, second] = frame.creators;
    if (first === undefined || second === undefined) throw new Error("no creators");
    const base = withDrafts([draft({ id: "a", kind: "first", state: "ready" })]);
    const out = await service.overlay({
      ...base,
      reach: { ...base.reach, threads: [thread(first.id, false), thread(second.id, true)] },
    });
    // One draft waiting, one reply that is their move; the answered one is not counted.
    expect(out.counts.reach).toBe(2);
  });

  it("strips a reply's rate from the readings when the member can't see money", async () => {
    const { service } = make();
    const creator = frame.creators[0]?.id ?? "c1";
    const reading = {
      replyType: "inf.gives_rate",
      label: "Rate",
      summary: "s",
      side: "influencer",
      corrected: false,
      facts: [
        { key: "rate", rate: 900, saved: false },
        { key: "age", band: "25-34", saved: false },
      ],
    } as const;
    const withRate = {
      ...frame,
      reach: {
        ...frame.reach,
        threads: [
          {
            creator,
            count: 1,
            lastOutAt: null,
            answered: false,
            lastIn: { id: "m", at: 1, reading, preview: "", bounce: false },
          },
        ],
      },
    };
    const hidden = await service.overlay({ ...withRate, seesMoney: false });
    expect(hidden.reach.threads[0]?.lastIn?.reading?.facts).toEqual([
      { key: "age", band: "25-34", saved: false },
    ]);
    const shown = await service.overlay({ ...withRate, seesMoney: true });
    expect(shown.reach.threads[0]?.lastIn?.reading?.facts).toHaveLength(2);
  });

  it("signs with the profile name once a frame has been read", async () => {
    const { service } = make();
    const out = await service.overlay({ ...frame, myName: "  Sara  " });
    expect(out.reach.sender).toBe("Sara");
  });

  it("answers no_data with no source, and the thread with one", async () => {
    const none = make({ source: () => null, mode: () => null });
    expect(await none.service.thread("c1")).toEqual({ ok: false, problem: "no_data" });
    expect(await none.service.refreshMailboxes()).toEqual({ ok: false, problem: "no_data" });
    const some = make();
    expect(await some.service.thread("c1")).toEqual({ ok: true, messages: [] });
  });

  it("tells the page at most once per gap", async () => {
    let at = 1_000_000;
    const timers: (() => void)[] = [];
    const { service, emit } = make({
      now: () => at,
      setTimer: (run) => timers.push(run),
      clearTimer: () => undefined,
    });
    await service.refreshMailboxes();
    await service.refreshMailboxes();
    await service.refreshMailboxes();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(timers).toHaveLength(1);
    at += changedGapMs;
    timers[0]?.();
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it("opens on example data without a job or a Gemini call", async () => {
    const timers: (() => void)[] = [];
    const { service, runQuickJob, call } = make({
      setTimer: (run) => timers.push(run),
      clearTimer: () => undefined,
    });
    await service.opened();
    service.closed();
    service.dispose();
    expect(runQuickJob).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });
});

// --- the mailboxes, the test email and the zones (plan step 6b, D20 and D21) ---

const boxes = [
  { address: "Outreach1@Gratovo.example", dailyCap: 30, warmupStartedOn: "2026-10-01" },
  { address: "outreach2@gratovo.example", dailyCap: 20, warmupStartedOn: null },
];

interface Setup {
  settings: Map<string, unknown>;
  commit: ReturnType<typeof vi.fn>;
  deps: Partial<ReachServiceDeps>;
}

/** A source with mail settings and a writable local settings map. */
function mailSetup(flags?: unknown): Setup {
  const settings = new Map<string, unknown>([
    ["mail.settings", { label: "Gratovo Outreach", senderName: null, mailboxes: boxes }],
  ]);
  if (flags !== undefined) {
    settings.set("reach.mailboxes", flags);
  }
  const commit = vi.fn();
  const base = fakeSource() as unknown as { outreach: Record<string, unknown> };
  const source = {
    ...base,
    readSetting: (key: string) => settings.get(key),
    writeSetting: (key: string, value: unknown) => settings.set(key, value),
    write: () => Promise.resolve(),
    outreach: { ...base.outreach, commit },
  } as unknown as DataSource;
  return { settings, commit, deps: { source: () => source } };
}

const sendOk = {
  ok: true,
  replies: [],
  exit: {
    kind: "ended",
    end: { type: "end", state: "done", at: 0, found: 0, kept: 0 },
    result: {
      type: "result",
      kind: "mail.send",
      data: {
        messageId: "m",
        threadId: "t",
        account: "outreach2@gratovo.example",
        to: "outreach2@gratovo.example",
        conversationKey: "k",
        sentAt: "2026-10-25T10:00:00.000Z",
        duplicate: false,
      },
    },
  },
} as unknown as JobOutcome;

const liveDeps = (runQuickJob: ReachServiceDeps["runQuickJob"]): Partial<ReachServiceDeps> => ({
  mode: () => "live",
  jobs: {
    jobContext: () => ({ dataDir: "data", worker: "w1" }),
    secrets: { get: () => Promise.resolve(undefined) } as never,
  },
  runQuickJob,
  connected: () => Promise.resolve(["outreach1@gratovo.example", "outreach2@gratovo.example"]),
});

/** The `mail.send` messages a fake lane saw. */
function sendingLane(answer: JobOutcome) {
  const sent: { sendKey: string; [key: string]: unknown }[] = [];
  const runQuickJob = vi.fn((start: Start): Promise<JobOutcome> => {
    if (start.job.kind === "mail.send") {
      sent.push(start.job.message);
      return Promise.resolve(answer);
    }
    return Promise.resolve({ ok: false, problem: "no_python" });
  });
  return { sent, runQuickJob };
}

describe("reach:mailbox-set", () => {
  it("answers no_data with no source and not_found for an unknown address", async () => {
    const none = make({ source: () => null, mode: () => null });
    expect(await none.service.setMailbox({ address: "a@b.example", paused: true })).toEqual({
      ok: false,
      problem: "no_data",
    });
    const { deps } = mailSetup();
    const { service } = make(deps);
    expect(await service.setMailbox({ address: "nobody@gratovo.example", paused: true })).toEqual({
      ok: false,
      problem: "not_found",
    });
  });

  it("rewrites the cap and keeps the warm-up date, whatever the case of the address", async () => {
    const { settings, deps } = mailSetup();
    const { service, emit } = make(deps);
    expect(
      await service.setMailbox({ address: "outreach1@GRATOVO.example", dailyCap: 45 }),
    ).toEqual({ ok: true });
    expect(settings.get("mail.settings")).toEqual({
      label: "Gratovo Outreach",
      senderName: null,
      mailboxes: [
        { address: "Outreach1@Gratovo.example", dailyCap: 45, warmupStartedOn: "2026-10-01" },
        boxes[1],
      ],
    });
    expect(settings.has("reach.mailboxes")).toBe(false);
    expect(emit).toHaveBeenCalled();
  });

  it("pauses and resumes in the reach.mailboxes setting and keeps the slowdown", async () => {
    const { settings, deps } = mailSetup({
      "outreach2@gratovo.example": { paused: false, slowed: true },
    });
    const { service, emit } = make(deps);
    await service.setMailbox({ address: "Outreach2@gratovo.example", paused: true });
    expect(settings.get("reach.mailboxes")).toEqual({
      "outreach2@gratovo.example": { paused: true, slowed: true },
    });
    expect(emit).toHaveBeenCalled();
    await service.setMailbox({ address: "outreach2@gratovo.example", paused: false });
    expect(settings.get("reach.mailboxes")).toEqual({
      "outreach2@gratovo.example": { paused: false, slowed: true },
    });
    // The cap was not touched.
    expect(settings.get("mail.settings")).toMatchObject({ mailboxes: boxes });
  });

  it("shows the pause in the next frame", async () => {
    const { deps } = mailSetup();
    const { service } = make(deps);
    await service.setMailbox({ address: "outreach2@gratovo.example", paused: true });
    const out = await service.overlay(frame);
    expect(out.reach.mailboxes.find((m) => m.address.startsWith("outreach2"))).toMatchObject({
      paused: true,
      status: "paused",
    });
  });
});

describe("reach:send-test", () => {
  it("refuses with no data, an unknown address, a pause or a test already running", async () => {
    const none = make({ source: () => null, mode: () => null });
    expect(await none.service.sendTest("outreach2@gratovo.example")).toEqual({
      ok: false,
      problem: "no_data",
    });
    const { deps } = mailSetup({ "outreach2@gratovo.example": { paused: true, slowed: false } });
    const timers: (() => void)[] = [];
    const { service } = make({ ...deps, setTimer: (run) => timers.push(run) });
    expect(await service.sendTest("nobody@gratovo.example")).toEqual({
      ok: false,
      problem: "not_found",
    });
    expect(await service.sendTest("outreach2@gratovo.example")).toEqual({
      ok: false,
      problem: "paused",
    });
    // The example test waits 600 ms; a second one for the same address meanwhile is busy.
    const first = service.sendTest("Outreach1@gratovo.example");
    expect(await service.sendTest("outreach1@gratovo.example")).toEqual({
      ok: false,
      problem: "busy",
    });
    timers.at(-1)?.();
    expect(await first).toEqual({ ok: true });
  });

  it("answers an example test after 600 ms and starts no job", async () => {
    const { deps } = mailSetup();
    const waits: number[] = [];
    const { service, runQuickJob } = make({
      ...deps,
      setTimer: (run, ms) => {
        waits.push(ms);
        run();
        return 1;
      },
    });
    expect(await service.sendTest("outreach1@gratovo.example")).toEqual({ ok: true });
    expect(waits).toContain(exampleTestMs);
    expect(runQuickJob).not.toHaveBeenCalled();
  });

  it("refuses an unconnected mailbox in live mode without a job", async () => {
    const { deps } = mailSetup();
    const { sent, runQuickJob } = sendingLane(sendOk);
    const { service } = make({
      ...deps,
      ...liveDeps(runQuickJob),
      connected: () => Promise.resolve(["outreach1@gratovo.example"]),
    });
    expect(await service.sendTest("outreach2@gratovo.example")).toEqual({
      ok: false,
      problem: "not_connected",
    });
    expect(sent).toHaveLength(0);
  });

  it("sends one mail.send with an approver and stores nothing, on a click only", async () => {
    const { deps, commit } = mailSetup();
    const { sent, runQuickJob } = sendingLane(sendOk);
    const { service, call } = make({ ...deps, ...liveDeps(runQuickJob) });
    // Nothing sends before a click: opening, refreshing and writing start no mail.send.
    await service.opened();
    await service.refreshMailboxes();
    service.afterWrite([
      { kind: "creator.stage", id: "c", stage: "contact", handle: "h", name: "n" },
    ]);
    await service.setMailbox({ address: "outreach2@gratovo.example", dailyCap: 25 });
    expect(sent).toHaveLength(0);

    expect(await service.sendTest("Outreach2@gratovo.example")).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: "outreach2@gratovo.example",
      mailbox: "outreach2@gratovo.example",
      subject: "Gratovo test email",
      newThread: true,
      approvedBy: frame.me,
    });
    expect(sent[0]?.sendKey).toMatch(/^test-[0-9a-f-]{36}$/);
    expect(sent[0]?.["body"]).toContain("This is a test from Gratovo");
    expect(commit).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
    // Each click is one job with its own key.
    await service.sendTest("outreach2@gratovo.example");
    expect(sent).toHaveLength(2);
    expect(new Set(sent.map((m) => m.sendKey)).size).toBe(2);
  });

  it("answers failed for a failed job and logs the code, never the mail", async () => {
    const { deps } = mailSetup();
    const lines: string[] = [];
    const failed = {
      ok: true,
      replies: [],
      exit: {
        kind: "ended",
        end: {
          type: "end",
          state: "failed",
          at: 0,
          found: 0,
          kept: 0,
          error: { code: "mail_auth", message: "Gratovo test email token revoked" },
        },
        result: null,
      },
    } as unknown as JobOutcome;
    const { runQuickJob } = sendingLane(failed);
    const { service } = make({ ...deps, ...liveDeps(runQuickJob), log: (l) => lines.push(l) });
    expect(await service.sendTest("outreach2@gratovo.example")).toEqual({
      ok: false,
      problem: "failed",
    });
    const joined = lines.join("\n");
    expect(joined).toContain("mail_auth");
    expect(joined).not.toContain("outreach2@");
    expect(joined).not.toContain("Gratovo test email");
    expect(joined).not.toContain("This is a test");
  });
});

describe("the zones overlay", () => {
  const open = [
    draft({ id: "a", creator: "c6", state: "ready" }),
    draft({ id: "b", creator: "c13", state: "approved" }),
    draft({ id: "c", creator: "c7", state: "sent" }),
    draft({ id: "d", creator: "cx", state: "ready" }),
  ];

  it("gives the example creators with an open draft their zone", async () => {
    const { service } = make();
    const out = await service.overlay(withDrafts(open));
    expect(Object.keys(out.reach.zones)).toEqual(["c6", "c13"]);
    expect(out.reach.zones["c6"]).toBe(zoneOf("US"));
  });

  it("asks the catalog for the creators with an open draft and skips unknown countries", async () => {
    const asked: (readonly string[])[] = [];
    const { service } = make({
      mode: () => "live",
      countries: (ids) => {
        asked.push(ids);
        return Promise.resolve(
          new Map([
            ["c6", "DE"],
            ["c13", "ZZ"],
          ]),
        );
      },
    });
    const out = await service.overlay(withDrafts(open));
    expect(asked).toEqual([["c6", "c13", "cx"]]);
    expect(out.reach.zones).toEqual({ c6: zoneOf("DE") });
  });

  it("keeps the frame when the catalog fails", async () => {
    const { service } = make({
      mode: () => "live",
      countries: () => Promise.reject(new Error("no catalog")),
    });
    const out = await service.overlay(withDrafts(open));
    expect(out.reach.zones).toEqual({});
  });
});
