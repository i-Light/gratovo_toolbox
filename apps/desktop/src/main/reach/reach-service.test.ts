import { exampleFrame, type DataSource, type Frame, type StoredDraft } from "@gratovo/core/data";
import { describe, expect, it, vi } from "vitest";

import { changedGapMs, createReachService, type ReachServiceDeps } from "./reach-service";

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
  it("counts drafts waiting and replies to answer for the rail", () => {
    const { service } = make();
    const out = service.overlay(
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

  it("signs with the profile name once a frame has been read", () => {
    const { service } = make();
    const out = service.overlay({ ...frame, myName: "  Sara  " });
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
